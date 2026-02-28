# Easy Reader - 小说阅读器

Easy Reader 是一个基于 React + Flask 的本地小说阅读应用，支持章节导航、书签管理和流式语音朗读。  
当前版本重点优化了长文本 TTS 的首播速度与总耗时表现。

## 功能特性

- 📁 **TXT 上传与自动解码**：上传 `.txt` 后自动检测编码并转为 UTF-8
- 📑 **章节导航**：自动识别章节并快速跳转
- 🔖 **书签管理**：添加、查看、跳转、清空书签
- 🎧 **流式语音朗读**：后端分段生成，前端收到首段即可播放
- ⚡ **音频缓存**：按文本+语音参数缓存 MP3，重复朗读可复用
- 📱 **响应式界面**：支持桌面端阅读与播放操作

## 技术栈

### 前端

- React
- Vite
- Tailwind CSS
- 原生 `Audio` + 流式解析 SSE

### 后端

- Python 3.11
- Flask
- Flask-CORS
- edge-tts

## 快速开始

### 1) 安装依赖

前端：

```bash
cd frontend
npm install
```

后端：

```bash
cd backend
python3 -m pip install -r requirements.txt
```

### 2) 启动服务


#### 一键启动

```bash
bash start.sh
```

#### 前后端分开启动

启动后端（默认端口 `5001`）：

```bash
cd backend
python3 app.py
```

启动前端（默认端口 `5173`）：

```bash
cd frontend
npm run dev
```

### 3) 使用流程

1. 上传小说 `.txt` 文件
2. 从左侧章节列表选择章节
3. 点击“开始朗读”触发流式 TTS
4. 使用“播放/暂停/停止”控制播放
5. 按需添加书签用于回跳

## API 接口

### `POST /api/upload`

上传并解析文本文件。

请求：`multipart/form-data`，字段名 `file`  
响应：

```json
{
  "success": true,
  "content": "解析后的文本内容"
}
```

### `POST /api/tts`

同步整段 TTS（返回单个 MP3 文件）。

请求体：

```json
{
  "text": "要转换的文本",
  "speed": 0,
  "volume": 0,
  "voice": "zh-CN-YunxiNeural"
}
```

### `POST /api/tts/stream`

流式 TTS（SSE）。后端按分段生成并逐段推送。

请求体：

```json
{
  "text": "长文本",
  "speed": 0,
  "volume": 0,
  "voice": "zh-CN-YunxiNeural",
  "segment_size": 450,
  "first_segment_size": 220
}
```

参数说明：

- `segment_size`：普通分段最大长度，建议 `320~450`
- `first_segment_size`：首段长度，建议 `160~220`，越小首播越快

SSE 事件：

- `event: segment`：单段音频（`audio_base64`）
- `event: progress`：进度信息（`current/total/percentage`）
- `event: complete`：生成完成
- `event: error`：生成失败

### `GET /api/voices`

获取可用语音列表。

## 性能与调参建议

当前瓶颈主要在 edge-tts 网络生成，不在编码与前端解码。建议：

- 首播优化：减小 `first_segment_size`（如 `180`）
- 总耗时优化：减小 `segment_size`（如 `360`）并保持后端并发预生成
- 命中缓存：同一段文本使用相同 `voice/speed/volume` 可直接复用

## 日志排查

后端日志会输出以下关键字段：

- `request received`：请求参数总览
- `segment_preview`：前几段原文预览（便于检查切分）
- `cache=hit/miss`：缓存命中情况
- `tts_elapsed_ms`：单段 TTS 生成耗时
- `wait_elapsed_ms`：顺序返回阶段等待耗时
- `total_elapsed_ms`：请求总耗时

可据此快速判断是“切分问题、缓存问题还是 TTS 生成慢”。

## 目录结构

```text
easy-reader/
├── frontend/
│   └── src/
│       └── App.jsx
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   └── audio_cache/
│       └── .gitkeep
├── .gitignore
└── README.md
```

## 关于 `audio_cache`

- 运行时生成的 MP3 缓存位于 `backend/audio_cache/`
- `.gitignore` 已忽略缓存文件，仅保留 `backend/audio_cache/.gitkeep`

## 注意事项

- 请确保前后端服务同时启动
- TTS 功能依赖网络（edge-tts）
- 当前主要支持 `.txt` 文本阅读

## 许可证

MIT
