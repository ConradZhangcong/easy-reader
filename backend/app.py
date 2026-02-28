import asyncio
import base64
import hashlib
import json
import os
import re
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import chardet
import edge_tts
from flask import Flask, Response, jsonify, request, send_file
from flask_cors import CORS

# 音频缓存目录
CACHE_DIR = 'audio_cache'
MAX_CACHED_CHAPTERS = 3
CACHE_INDEX_FILE = os.path.join(CACHE_DIR, 'cache_index.json')
os.makedirs(CACHE_DIR, exist_ok=True)
cache_index_lock = threading.Lock()

app = Flask(__name__)
CORS(app)  # 添加 CORS 支持，允许前端跨域请求


def load_cache_index():
    """加载章节缓存索引（LRU 顺序：最近使用在前）。"""
    if not os.path.exists(CACHE_INDEX_FILE):
        return {"order": []}

    try:
        with open(CACHE_INDEX_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        order = data.get("order", [])
        if not isinstance(order, list):
            return {"order": []}
        return {"order": [item for item in order if isinstance(item, str)]}
    except Exception:
        return {"order": []}


def save_cache_index(index_data):
    """原子写入缓存索引，避免并发写坏文件。"""
    temp_path = f"{CACHE_INDEX_FILE}.tmp"
    with open(temp_path, 'w', encoding='utf-8') as f:
        json.dump(index_data, f, ensure_ascii=False)
    os.replace(temp_path, CACHE_INDEX_FILE)


def build_chapter_cache_key(mode, text, speed, volume, voice, segment_size=None, first_segment_size=None):
    """构造章节级缓存 key。"""
    raw = f"{mode}-{text}-{speed}-{volume}-{voice}"
    if mode == "stream":
        raw = f"{raw}-{segment_size}-{first_segment_size}"
    return hashlib.md5(raw.encode('utf-8')).hexdigest()


def get_chapter_cache_dir(chapter_key):
    return os.path.join(CACHE_DIR, chapter_key)


def prune_cache_if_needed(index_data):
    """最多仅保留最近 MAX_CACHED_CHAPTERS 个章节缓存。"""
    order = index_data.get("order", [])
    while len(order) > MAX_CACHED_CHAPTERS:
        stale_key = order.pop()
        stale_dir = get_chapter_cache_dir(stale_key)
        if os.path.isdir(stale_dir):
            shutil.rmtree(stale_dir, ignore_errors=True)
            print(f"[CACHE] removed stale chapter cache: {stale_key}")
    index_data["order"] = order


def touch_chapter_cache(chapter_key):
    """
    标记章节缓存最近使用并触发 LRU 淘汰。
    """
    with cache_index_lock:
        index_data = load_cache_index()
        order = [key for key in index_data.get("order", []) if key != chapter_key]
        order.insert(0, chapter_key)
        index_data["order"] = order
        prune_cache_if_needed(index_data)
        save_cache_index(index_data)


def cleanup_legacy_flat_cache_files():
    """
    清理旧版直接平铺在 audio_cache 下的 mp3 缓存文件。
    新版缓存按章节子目录存储。
    """
    for name in os.listdir(CACHE_DIR):
        file_path = os.path.join(CACHE_DIR, name)
        if os.path.isfile(file_path) and name.endswith('.mp3'):
            try:
                os.remove(file_path)
                print(f"[CACHE] removed legacy flat cache file: {name}")
            except Exception as err:
                print(f"[CACHE] failed to remove legacy cache file {name}: {err}")


cleanup_legacy_flat_cache_files()


def split_text_into_segments(text, max_segment_size, first_segment_size=None):
    """
    按句子/换行优先切分文本，尽量保证每段长度不超过 max_segment_size。
    """
    sentences = re.split(r'(?<=[。！？!?；;\n])', text)
    segments = []
    current = ""
    first_limit = int(first_segment_size) if first_segment_size else max_segment_size
    current_limit = first_limit

    for sentence in sentences:
        if not sentence:
            continue

        if len(sentence) > current_limit:
            if current.strip():
                segments.append(current.strip())
                current = ""
                current_limit = max_segment_size
            for i in range(0, len(sentence), current_limit):
                part = sentence[i:i + current_limit].strip()
                if part:
                    segments.append(part)
                    current_limit = max_segment_size
            continue

        if len(current) + len(sentence) <= current_limit:
            current += sentence
        else:
            if current.strip():
                segments.append(current.strip())
                current_limit = max_segment_size
            current = sentence

    if current.strip():
        segments.append(current.strip())

    return segments


def format_sse_event(event_name, payload):
    return f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """
    文件上传 API 端点
    接收上传的文件，自动检测编码并转换为 UTF-8
    """
    try:
        # 检查是否有文件上传
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file uploaded'}), 400
        
        file = request.files['file']
        
        # 检查文件名是否为空
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'}), 400
        
        # 读取文件内容
        file_content = file.read()
        
        # 检测文件编码
        result = chardet.detect(file_content)
        detected_encoding = result['encoding']
        confidence = result['confidence']
        
        print(f"Detected encoding: {detected_encoding} (confidence: {confidence})")
        
        # 尝试解码文件内容
        try:
            if detected_encoding:
                # 使用检测到的编码解码
                content = file_content.decode(detected_encoding)
            else:
                # 如果无法检测到编码，尝试使用 UTF-8
                content = file_content.decode('utf-8')
        except UnicodeDecodeError:
            # 如果解码失败，尝试使用 GBK
            try:
                content = file_content.decode('gbk')
            except UnicodeDecodeError:
                # 如果仍然失败，使用 latin-1 作为最后的尝试
                content = file_content.decode('latin-1')
        
        # 返回解码后的内容
        return jsonify({'success': True, 'content': content})
        
    except Exception as e:
        print(f"Error in upload_file: {str(e)}")
        return jsonify({'success': False, 'error': f'Internal server error: {str(e)}'}), 500

@app.route('/api/tts', methods=['POST'])
def text_to_speech():
    """
    文字转语音 API 端点
    接收 JSON 格式的请求，包含以下参数：
    - text: 要转换的文本
    - speed: 语速，默认 0
    - volume: 音量，默认 0
    - voice: 语音 ID，默认 zh-CN-YunxiNeural
    """
    try:
        # 获取请求数据
        data = request.json
        if not data or 'text' not in data:
            return jsonify({'error': 'Missing required parameter: text'}), 400
        
        # 提取参数
        text = data['text']
        speed = data.get('speed', 0)
        volume = data.get('volume', 0)
        voice = data.get('voice', 'zh-CN-YunxiNeural')
        
        # 确保文本不为空
        if not text.strip():
            return jsonify({'error': 'Text cannot be empty'}), 400
        
        # 章节级缓存目录（最多保留最近 3 个章节）
        chapter_key = build_chapter_cache_key("full", text, speed, volume, voice)
        chapter_cache_dir = get_chapter_cache_dir(chapter_key)
        os.makedirs(chapter_cache_dir, exist_ok=True)
        cache_file_path = os.path.join(chapter_cache_dir, "full.mp3")
        
        # 检查缓存是否存在
        if os.path.exists(cache_file_path):
            touch_chapter_cache(chapter_key)
            print(f"Using cached audio for chapter: {chapter_key}")
            return send_file(cache_file_path, mimetype='audio/mpeg', as_attachment=False)
        
        # 生成音频
        async def generate_audio():
            # 格式化参数
            rate_str = f"{'+' if speed >= 0 else ''}{speed}%"
            volume_str = f"{'+' if volume >= 0 else ''}{volume}%"
            
            # 创建 TTS 实例
            communicate = edge_tts.Communicate(text, voice, rate=rate_str, volume=volume_str)
            
            # 保存音频到缓存文件
            await communicate.save(cache_file_path)
            return cache_file_path
        
        # 运行异步函数
        audio_file_path = asyncio.run(generate_audio())
        touch_chapter_cache(chapter_key)
        
        # 返回音频文件
        return send_file(audio_file_path, mimetype='audio/mpeg', as_attachment=False)
        
    except Exception as e:
        print(f"Error in text_to_speech: {str(e)}")
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@app.route('/api/tts/stream', methods=['POST'])
def text_to_speech_stream():
    """
    流式文字转语音 API 端点
    接收 JSON 格式的请求，包含以下参数：
    - text: 要转换的长文本
    - speed: 语速，默认 0
    - volume: 音量，默认 0
    - voice: 语音 ID，默认 zh-CN-YunxiNeural
    - segment_size: 分段大小，默认 450
    - first_segment_size: 首段分段大小，默认 220（用于更快首播）
    """
    try:
        # 获取请求数据
        data = request.json
        if not data or 'text' not in data:
            return jsonify({'error': 'Missing required parameter: text'}), 400
        
        # 提取参数
        text = data['text']
        speed = data.get('speed', 0)
        volume = data.get('volume', 0)
        voice = data.get('voice', 'zh-CN-YunxiNeural')
        segment_size = int(data.get('segment_size', 450))
        first_segment_size = int(data.get('first_segment_size', 220))
        
        # 确保文本不为空
        if not text.strip():
            return jsonify({'error': 'Text cannot be empty'}), 400
        
        request_id = hashlib.md5(f"{time.time()}-{len(text)}-{voice}".encode('utf-8')).hexdigest()[:8]
        request_start = time.perf_counter()

        print(
            f"[TTS-STREAM][{request_id}] request received, text_length={len(text)}, "
            f"segment_size={segment_size}, first_segment_size={first_segment_size}, voice={voice}, speed={speed}, volume={volume}"
        )
        segments = split_text_into_segments(text, segment_size, first_segment_size=first_segment_size)
        total_segments = len(segments)
        print(f"[TTS-STREAM][{request_id}] split done, total_segments={total_segments}")
        chapter_key = build_chapter_cache_key(
            "stream", text, speed, volume, voice, segment_size, first_segment_size
        )
        chapter_cache_dir = get_chapter_cache_dir(chapter_key)
        os.makedirs(chapter_cache_dir, exist_ok=True)
        touch_chapter_cache(chapter_key)

        # 打印前几个分段原文预览，辅助定位切分是否合理
        preview_count = min(5, total_segments)
        for idx in range(preview_count):
            segment_preview = segments[idx].replace('\n', '\\n')
            if len(segment_preview) > 180:
                segment_preview = segment_preview[:180] + "...(truncated)"
            print(f"[TTS-STREAM][{request_id}] segment_preview[{idx + 1}/{total_segments}] len={len(segments[idx])} text={segment_preview}")

        rate_str = f"{'+' if speed >= 0 else ''}{speed}%"
        volume_str = f"{'+' if volume >= 0 else ''}{volume}%"

        async def generate_segment_audio(segment_text, cache_path):
            communicate = edge_tts.Communicate(segment_text, voice, rate=rate_str, volume=volume_str)
            await communicate.save(cache_path)

        def generate_segment_sync(segment_text, cache_file_path):
            gen_start = time.perf_counter()
            asyncio.run(generate_segment_audio(segment_text, cache_file_path))
            return (time.perf_counter() - gen_start) * 1000

        def generate():
            try:
                if total_segments == 0:
                    print(f"[TTS-STREAM][{request_id}] no segments, complete immediately")
                    yield format_sse_event("complete", {"total": 0})
                    return

                segment_meta = []
                for i, segment in enumerate(segments):
                    segment_cache_key = hashlib.md5(
                        f"{segment}-{speed}-{volume}-{voice}".encode('utf-8')
                    ).hexdigest()
                    cache_file_path = os.path.join(chapter_cache_dir, f"{segment_cache_key}.mp3")
                    segment_meta.append({
                        "index": i,
                        "text": segment,
                        "cache_file_path": cache_file_path,
                        "cache_hit": os.path.exists(cache_file_path),
                    })

                first = segment_meta[0]
                remaining = segment_meta[1:]
                future_map = {}
                executor = None

                try:
                    # 在生成首段时并行预取后续分段，进一步缩短总耗时
                    if remaining:
                        max_workers = min(4, len(remaining))
                        print(f"[TTS-STREAM][{request_id}] prefetch start, remaining={len(remaining)}, workers={max_workers}")
                        executor = ThreadPoolExecutor(max_workers=max_workers)
                        for meta in remaining:
                            if meta["cache_hit"]:
                                print(f"[TTS-STREAM][{request_id}] segment {meta['index'] + 1}/{total_segments} cache=hit")
                                continue
                            print(f"[TTS-STREAM][{request_id}] segment {meta['index'] + 1}/{total_segments} cache=miss, queued")
                            future_map[meta["index"]] = executor.submit(
                                generate_segment_sync,
                                meta["text"],
                                meta["cache_file_path"],
                            )

                    # 第一段优先返回，保证首播速度
                    first_start = time.perf_counter()
                    if not first["cache_hit"]:
                        print(f"[TTS-STREAM][{request_id}] segment 1/{total_segments} cache=miss, generating (first segment priority)")
                        gen_elapsed_ms = generate_segment_sync(first["text"], first["cache_file_path"])
                        print(f"[TTS-STREAM][{request_id}] segment 1/{total_segments} generated, tts_elapsed_ms={gen_elapsed_ms:.1f}")
                    else:
                        print(f"[TTS-STREAM][{request_id}] segment 1/{total_segments} cache=hit")

                    encode_start = time.perf_counter()
                    with open(first["cache_file_path"], 'rb') as f:
                        first_audio_base64 = base64.b64encode(f.read()).decode('utf-8')
                    encode_elapsed_ms = (time.perf_counter() - encode_start) * 1000
                    first_elapsed_ms = (time.perf_counter() - first_start) * 1000
                    print(
                        f"[TTS-STREAM][{request_id}] segment 1/{total_segments} ready, "
                        f"base64_len={len(first_audio_base64)}, encode_elapsed_ms={encode_elapsed_ms:.1f}, segment_elapsed_ms={first_elapsed_ms:.1f}"
                    )
                    yield format_sse_event("segment", {
                        "index": 0,
                        "current": 1,
                        "total": total_segments,
                        "audio_base64": first_audio_base64,
                    })
                    yield format_sse_event("progress", {
                        "current": 1,
                        "total": total_segments,
                        "percentage": int(100 / total_segments),
                    })

                    # 后续分段按顺序返回
                    for meta in remaining:
                        idx = meta["index"]
                        wait_start = time.perf_counter()
                        if idx in future_map:
                            gen_elapsed_ms = future_map[idx].result()
                            print(f"[TTS-STREAM][{request_id}] segment {idx + 1}/{total_segments} generated, tts_elapsed_ms={gen_elapsed_ms:.1f}")
                        wait_elapsed_ms = (time.perf_counter() - wait_start) * 1000

                        encode_start = time.perf_counter()
                        with open(meta["cache_file_path"], 'rb') as f:
                            audio_base64 = base64.b64encode(f.read()).decode('utf-8')
                        encode_elapsed_ms = (time.perf_counter() - encode_start) * 1000
                        print(
                            f"[TTS-STREAM][{request_id}] segment {idx + 1}/{total_segments} ready, "
                            f"base64_len={len(audio_base64)}, wait_elapsed_ms={wait_elapsed_ms:.1f}, encode_elapsed_ms={encode_elapsed_ms:.1f}"
                        )

                        yield format_sse_event("segment", {
                            "index": idx,
                            "current": idx + 1,
                            "total": total_segments,
                            "audio_base64": audio_base64,
                        })
                        yield format_sse_event("progress", {
                            "current": idx + 1,
                            "total": total_segments,
                            "percentage": int((idx + 1) * 100 / total_segments),
                        })
                finally:
                    if executor is not None:
                        executor.shutdown(wait=False)

                yield format_sse_event("complete", {"total": total_segments})
                total_elapsed_ms = (time.perf_counter() - request_start) * 1000
                print(f"[TTS-STREAM][{request_id}] complete, total_segments={total_segments}, total_elapsed_ms={total_elapsed_ms:.1f}")
            except Exception as err:
                total_elapsed_ms = (time.perf_counter() - request_start) * 1000
                print(f"[TTS-STREAM][{request_id}] error after {total_elapsed_ms:.1f}ms: {str(err)}")
                yield format_sse_event("error", {"message": str(err)})

        response = Response(generate(), mimetype='text/event-stream')
        response.headers['Cache-Control'] = 'no-cache'
        response.headers['X-Accel-Buffering'] = 'no'
        return response
        
    except Exception as e:
        print(f"Error in text_to_speech_stream: {str(e)}")
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@app.route('/api/voices', methods=['GET'])
def list_voices():
    """
    获取可用语音列表
    """
    try:
        async def get_voices():
            voices = await edge_tts.list_voices()
            return [{
                'name': voice['FriendlyName'],
                'id': voice['ShortName'],
                'locale': voice['Locale']
            } for voice in voices]
        
        voices = asyncio.run(get_voices())
        return jsonify(voices)
        
    except Exception as e:
        print(f"Error in list_voices: {str(e)}")
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

if __name__ == '__main__':
    # 启动 Flask 应用
    app.run(host='0.0.0.0', port=5001, debug=True)
