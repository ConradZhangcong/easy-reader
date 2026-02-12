import asyncio
import hashlib
import os
import tempfile

import chardet
import edge_tts
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

# 音频缓存目录
CACHE_DIR = 'audio_cache'
os.makedirs(CACHE_DIR, exist_ok=True)

app = Flask(__name__)
CORS(app)  # 添加 CORS 支持，允许前端跨域请求

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
        
        # 生成缓存键
        cache_key = hashlib.md5(f"{text}-{speed}-{volume}-{voice}".encode('utf-8')).hexdigest()
        cache_file_path = os.path.join(CACHE_DIR, f"{cache_key}.mp3")
        
        # 检查缓存是否存在
        if os.path.exists(cache_file_path):
            print(f"Using cached audio for key: {cache_key}")
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
        
        # 返回音频文件
        return send_file(audio_file_path, mimetype='audio/mpeg', as_attachment=False)
        
    except Exception as e:
        print(f"Error in text_to_speech: {str(e)}")
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
