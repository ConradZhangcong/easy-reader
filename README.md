# Easy Reader - 小说阅读器

一个基于 React 和 Flask 的小说阅读器应用，支持文本阅读、章节导航、书签管理和语音朗读功能。

## 功能特性

- 📁 **文件上传**：支持上传 .txt 格式的小说文件
- 📑 **章节导航**：自动检测章节，支持快速跳转
- 🔖 **书签管理**：添加、查看和跳转到书签
- 🎧 **语音朗读**：支持文字转语音，可调整语速和音量
- 📱 **响应式设计**：适配不同屏幕尺寸
- 🎨 **现代化界面**：使用 Tailwind CSS 构建美观的用户界面

## 技术栈

### 前端
- React 19.2.0
- Tailwind CSS 4.0.0
- JavaScript
- HTML5 / CSS3

### 后端
- Python 3.11
- Flask 2.0.1
- edge-tts 7.2.7
- Flask-CORS 3.0.10

## 快速开始

### 1. 安装依赖

#### 前端依赖
```bash
cd frontend
npm install
```

#### 后端依赖
```bash
cd backend
python3 -m pip install -r requirements.txt
```

### 2. 启动服务

#### 启动前端开发服务器
```bash
cd frontend
npm run dev
```
前端应用将运行在 http://localhost:5173

#### 启动后端 API 服务
```bash
cd backend
python3 app.py
```
后端服务将运行在 http://localhost:5001

### 3. 使用说明

1. **上传小说**：点击 "选择文件" 按钮上传 .txt 格式的小说文件
2. **阅读小说**：在右侧阅读区查看小说内容
3. **章节导航**：在左侧章节列表中点击章节标题快速跳转
4. **添加书签**：点击 "添加书签" 按钮保存当前章节位置
5. **语音朗读**：点击 "开始朗读" 按钮听取当前章节的语音朗读
6. **控制播放**：使用 "播放/暂停" 和 "停止" 按钮控制音频播放

## API 接口

### 文字转语音
- **URL**: `/api/tts`
- **方法**: `POST`
- **请求体**:
  ```json
  {
    "text": "要转换的文本",
    "speed": 语速（默认 0）,
    "volume": 音量（默认 0）,
    "voice": 语音 ID（默认 zh-CN-YunxiNeural）
  }
  ```
- **响应**: MP3 音频文件

### 获取语音列表
- **URL**: `/api/voices`
- **方法**: `GET`
- **响应**: 可用语音列表

## 项目结构

```
easy-reader/
├── frontend/          # 前端代码
│   ├── public/        # 静态资源
│   ├── src/           # 前端源代码
│   │   ├── assets/    # 图片等资源
│   │   ├── App.jsx    # 主应用组件
│   │   ├── main.jsx   # 应用入口
│   │   └── index.css  # 全局样式
│   ├── index.html     # HTML 模板
│   ├── package.json   # 前端配置
│   ├── vite.config.js # Vite 配置
│   └── ...            # 其他前端配置文件
├── backend/           # 后端代码
│   ├── app.py         # 后端 Flask 应用
│   └── requirements.txt # 后端依赖
└── README.md          # 项目文档
```

## 注意事项

1. 请确保同时启动前端和后端服务
2. 语音朗读功能需要网络连接，因为使用了 edge-tts 服务
3. 对于大型小说文件，章节检测可能需要一些时间
4. 目前仅支持 .txt 格式的小说文件

## 未来计划

- [ ] 支持更多文件格式（如 EPUB、PDF 等）
- [ ] 添加深色模式
- [ ] 实现阅读进度自动保存
- [ ] 支持云同步功能
- [ ] 添加更多语音选项

## 许可证

MIT License
