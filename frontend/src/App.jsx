import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  // 状态管理
  const [novelContent, setNovelContent] = useState('');
  const [novelTitle, setNovelTitle] = useState('');
  const [chapters, setChapters] = useState([]);
  const [currentChapter, setCurrentChapter] = useState(null);
  const [bookmarks, setBookmarks] = useState([]);
  const [showUpload, setShowUpload] = useState(true);
  const [audioUrl, setAudioUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);
  const [audioElement, setAudioElement] = useState(null);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // 初始化音频元素和加载缓存
  useEffect(() => {
    const audio = new Audio();
    
    // 监听播放进度
    audio.addEventListener('timeupdate', () => {
      if (!isDragging && !isNaN(audio.duration)) {
        setAudioProgress(audio.currentTime);
      }
    });
    
    // 监听时长变化
    audio.addEventListener('durationchange', () => {
      if (!isNaN(audio.duration)) {
        setAudioDuration(audio.duration);
      }
    });
    
    // 监听播放结束
    audio.addEventListener('ended', () => {
      setIsPlaying(false);
    });
    
    setAudioElement(audio);
    
    // 尝试加载缓存的文件
    const loadCachedFile = () => {
      try {
        const cachedData = localStorage.getItem('easyReaderCachedFile');
        if (cachedData) {
          const { novelContent, novelTitle, chapters, currentChapterIndex, bookmarks } = JSON.parse(cachedData);
          
          if (novelContent && novelTitle) {
            setNovelContent(novelContent);
            setNovelTitle(novelTitle);
            setChapters(chapters);
            setBookmarks(bookmarks || []);
            setShowUpload(false);
            
            // 设置当前章节
            if (chapters && chapters.length > 0 && currentChapterIndex >= 0) {
              setCurrentChapter(chapters[currentChapterIndex]);
            } else if (chapters && chapters.length > 0) {
              setCurrentChapter(chapters[0]);
            }
          }
        }
      } catch (error) {
        console.error('Error loading cached file:', error);
        // 如果加载失败，清除缓存
        localStorage.removeItem('easyReaderCachedFile');
      }
    };
    
    // 加载缓存
    loadCachedFile();
    
    return () => {
      if (audio) {
        audio.pause();
        audio.src = '';
        // 移除事件监听器
        audio.removeEventListener('timeupdate', () => {});
        audio.removeEventListener('durationchange', () => {});
        audio.removeEventListener('ended', () => {});
      }
    };
  }, [isDragging]);

  // 处理文件上传
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setNovelTitle(file.name);
    
    // 重置状态
    setChapters([]);
    setCurrentChapter(null);
    setBookmarks([]);
    setAudioUrl(null);
    setIsPlaying(false);
    setAudioProgress(0);
    setAudioDuration(0);
    if (audioElement) {
      audioElement.pause();
      audioElement.src = '';
    }
    
    // 创建 FormData 对象，用于上传文件
    const formData = new FormData();
    formData.append('file', file);
    
    // 发送文件到后端处理
    fetch('http://localhost:5001/api/upload', {
      method: 'POST',
      body: formData
    })
    .then(response => {
      if (!response.ok) {
        throw new Error('上传文件失败');
      }
      return response.json();
    })
    .then(data => {
      if (data.success) {
        const content = data.content;
        setNovelContent(content);
        detectChapters(content);
        setShowUpload(false);
      } else {
        throw new Error(data.error || '处理文件失败');
      }
    })
    .catch(error => {
      console.error('Error uploading file:', error);
      alert('上传文件失败:', error.message);
    });
  };

  // 检测章节
  const detectChapters = (content) => {
    const chapterPatterns = [
      /第[一二三四五六七八九十百千]+章[\s\S]*?/g,  // 中文数字章节
      /Chapter\s+\d+[\s\S]*?/g,  // 英文章节
      /CHAPTER\s+\d+[\s\S]*?/g,  // 大写英文章节
      /\d+\.\s+[\s\S]*?/g,  // 数字章节
    ];
    
    const detectedChapters = [];
    
    chapterPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const startPos = match.index;
        const chapterTitle = match[0].trim();
        detectedChapters.push({ id: startPos, title: chapterTitle, start: startPos });
      }
    });
    
    // 去重并排序
    const uniqueChapters = [...new Map(detectedChapters.map(ch => [ch.id, ch])).values()];
    uniqueChapters.sort((a, b) => a.start - b.start);
    
    // 添加结束位置
    const chaptersWithEnd = uniqueChapters.map((ch, index) => ({
      ...ch,
      end: index < uniqueChapters.length - 1 ? uniqueChapters[index + 1].start : content.length
    }));
    
    setChapters(chaptersWithEnd);
    if (chaptersWithEnd.length > 0) {
      setCurrentChapter(chaptersWithEnd[0]);
    }
  };

  // 跳转到章节
  const jumpToChapter = (chapter) => {
    setCurrentChapter(chapter);
  };

  // 添加书签
  const addBookmark = () => {
    if (!currentChapter) return;
    
    const newBookmark = {
      id: Date.now(),
      chapterId: currentChapter.id,
      chapterTitle: currentChapter.title,
      timestamp: new Date().toLocaleString()
    };
    
    setBookmarks([...bookmarks, newBookmark]);
  };

  // 清空书签
  const clearBookmarks = () => {
    setBookmarks([]);
  };

  // 跳转到书签
  const jumpToBookmark = (bookmark) => {
    const chapter = chapters.find(ch => ch.id === bookmark.chapterId);
    if (chapter) {
      setCurrentChapter(chapter);
    }
  };

  // 生成音频
  const generateAudio = async () => {
    if (!currentChapter || !novelContent) return;
    
    try {
      let chapterText = novelContent.substring(currentChapter.start, currentChapter.end);
      
      // 限制文本长度，提高音频生成速度
      const maxTextLength = 3000; // 最大文本长度
      if (chapterText.length > maxTextLength) {
        chapterText = chapterText.substring(0, maxTextLength);
        console.log('文本长度超过限制，已截断到', maxTextLength, '个字符');
      }
      
      // 发送请求到后端 API
      const response = await fetch('http://localhost:5001/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: chapterText,
          speed: 0,
          volume: 0,
          voice: 'zh-CN-YunxiNeural'
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate audio');
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      
      // 播放音频
      if (audioElement) {
        audioElement.src = url;
        audioElement.play();
        setIsPlaying(true);
      }
    } catch (error) {
      console.error('Error generating audio:', error);
      alert('生成音频失败，请确保后端服务正在运行');
    }
  };

  // 播放/暂停音频
  const togglePlay = () => {
    if (!audioElement || !audioUrl) return;
    
    if (isPlaying) {
      audioElement.pause();
    } else {
      audioElement.play();
    }
    setIsPlaying(!isPlaying);
  };

  // 停止音频
  const stopAudio = () => {
    if (!audioElement) return;
    
    audioElement.pause();
    audioElement.currentTime = 0;
    setAudioProgress(0);
    setIsPlaying(false);
  };
  
  // 处理进度条拖动开始
  const handleProgressBarStart = () => {
    setIsDragging(true);
  };
  
  // 处理进度条拖动
  const handleProgressBarChange = (e) => {
    if (!audioElement || !audioDuration) return;
    
    const value = parseFloat(e.target.value);
    setAudioProgress(value);
  };
  
  // 处理进度条拖动结束
  const handleProgressBarEnd = () => {
    if (!audioElement || !audioDuration) return;
    
    audioElement.currentTime = audioProgress;
    setIsDragging(false);
  };

  // 监听音频播放结束
  useEffect(() => {
    if (audioElement) {
      audioElement.onended = () => {
        setIsPlaying(false);
      };
    }
  }, [audioElement]);
  
  // 缓存文件内容和状态
  useEffect(() => {
    // 只有当有小说内容时才缓存
    if (novelContent && novelTitle) {
      try {
        const currentChapterIndex = chapters.findIndex(ch => ch.id === currentChapter?.id);
        const cacheData = {
          novelContent,
          novelTitle,
          chapters,
          currentChapterIndex: currentChapterIndex >= 0 ? currentChapterIndex : 0,
          bookmarks
        };
        
        // 将数据存储到 localStorage
        localStorage.setItem('easyReaderCachedFile', JSON.stringify(cacheData));
      } catch (error) {
        console.error('Error caching file:', error);
      }
    }
  }, [novelContent, novelTitle, chapters, currentChapter, bookmarks]);

  // 渲染章节内容
  const renderChapterContent = () => {
    if (!currentChapter || !novelContent) return '';
    
    const content = novelContent.substring(currentChapter.start, currentChapter.end);
    // 将文本按段落分割并渲染
    return content.split('\n\n').map((paragraph, index) => (
      <p key={index} className="mb-4">{paragraph}</p>
    ));
  };
  
  // 格式化时间（秒）为时分秒格式
  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* 隐藏的文件输入框 - 始终存在于DOM中 */}
      <input id="file-upload" type="file" accept=".txt" className="hidden" onChange={handleFileUpload} />
      
      {/* 顶部导航栏 */}
      <header className="bg-white shadow-md z-10">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <i className="fa fa-book text-blue-600 text-2xl"></i>
            <h1 className="text-xl font-bold text-gray-800">Easy Reader</h1>
          </div>
          <div className="flex items-center space-x-4">
            <button className="p-2 rounded-full hover:bg-gray-100">
              <i className="fa fa-moon-o text-gray-600"></i>
            </button>
            <button className="p-2 rounded-full hover:bg-gray-100">
              <i className="fa fa-cog text-gray-600"></i>
            </button>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="flex-1 flex overflow-hidden">
        {/* 左侧导航栏 - 固定宽度 */}
        <div className="w-1/4 bg-gray-50 border-r border-gray-200 overflow-y-auto">
          <div className="p-4">
            <div className="bg-white rounded-lg shadow-md p-4 mb-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center">
                <i className="fa fa-folder-open text-blue-600 mr-2"></i>
                章节导航
              </h2>
              <div className="border rounded-md overflow-hidden">
                <div className="p-2 bg-gray-50 border-b">
                  <input 
                    type="text" 
                    placeholder="搜索章节..." 
                    className="w-full px-3 py-1 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="max-h-[calc(100vh-240px)] overflow-y-auto p-2">
                  {chapters.length > 0 ? (
                    chapters.map((chapter) => (
                      <div
                        key={chapter.id}
                        className={`chapter-item p-2 rounded-md ${currentChapter?.id === chapter.id ? 'active' : ''}`}
                        onClick={() => jumpToChapter(chapter)}
                      >
                        {chapter.title}
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-gray-500 py-4">
                      请先上传小说文件
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-4">
              <h2 className="text-lg font-semibold mb-4 flex items-center">
                <i className="fa fa-bookmark text-blue-600 mr-2"></i>
                书签管理
              </h2>
              <div className="max-h-64 overflow-y-auto p-2">
                {bookmarks.length > 0 ? (
                  bookmarks.map((bookmark) => (
                    <div
                      key={bookmark.id}
                      className="p-2 rounded-md hover:bg-gray-50"
                      onClick={() => jumpToBookmark(bookmark)}
                    >
                      <div className="font-medium">{bookmark.chapterTitle}</div>
                      <div className="text-xs text-gray-500">{bookmark.timestamp}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-gray-500 py-4">
                    暂无书签
                  </div>
                )}
              </div>
              <div className="mt-4 flex justify-between">
                <button 
                  className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={addBookmark}
                  disabled={!currentChapter}
                >
                  <i className="fa fa-plus mr-1"></i> 添加书签
                </button>
                <button 
                  className="px-3 py-1 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={clearBookmarks}
                  disabled={bookmarks.length === 0}
                >
                  <i className="fa fa-trash mr-1"></i> 清空
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧阅读区 - 自适应宽度 */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* 文件上传区 */}
          {showUpload ? (
            <div className="bg-white rounded-lg shadow-md p-6 mb-6 text-center">
              <div className="mb-4">
                <i className="fa fa-cloud-upload text-gray-400 text-5xl"></i>
              </div>
              <h2 className="text-xl font-semibold mb-2">上传小说文件</h2>
              <p className="text-gray-600 mb-4">支持 .txt 文件，自动检测编码格式</p>
              <div className="flex justify-center">
                <label htmlFor="file-upload" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 cursor-pointer">
                  <i className="fa fa-file-text-o mr-2"></i> 选择文件
                </label>
              </div>
            </div>
          ) : (
            <>
              {/* 阅读区 */}
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold text-gray-800">{novelTitle}</h2>
                  <div className="flex items-center space-x-4">
                    {currentChapter && (
                      <span className="text-sm text-gray-500">
                        {chapters.indexOf(currentChapter) + 1} / {chapters.length}
                      </span>
                    )}
                    <button 
                      className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                      onClick={() => {
                        // 触发文件输入点击
                        document.getElementById('file-upload').click();
                      }}
                    >
                      <i className="fa fa-upload mr-1"></i> 重新上传
                    </button>
                  </div>
                </div>
                <div className="text-content">
                  {renderChapterContent()}
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      {/* 底部播放栏 - 固定位置 */}
      {!showUpload && (
        <div className="bg-white border-t border-gray-200 p-4 shadow-md z-10">
          <div className="container mx-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <h3 className="font-semibold flex items-center">
                  <i className="fa fa-volume-up text-blue-600 mr-2"></i>
                  语音朗读
                </h3>
                <button 
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  onClick={generateAudio}
                  disabled={!currentChapter}
                >
                  <i className="fa fa-play mr-2"></i> 开始朗读
                </button>
                <button 
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                  onClick={togglePlay}
                  disabled={!audioUrl}
                >
                  <i className={isPlaying ? "fa fa-pause mr-2" : "fa fa-play mr-2"}></i>
                  {isPlaying ? '暂停' : '播放'}
                </button>
                <button 
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                  onClick={stopAudio}
                  disabled={!audioUrl}
                >
                  <i className="fa fa-stop mr-2"></i> 停止
                </button>
              </div>
              {audioUrl && (
                <div className="flex-1 max-w-xl mx-8">
                  <div className="flex items-center space-x-3">
                    <span className="text-sm text-gray-500 min-w-[60px]">
                      {formatTime(audioProgress)}
                    </span>
                    <div className="flex-1">
                      <input
                        type="range"
                        min="0"
                        max={audioDuration || 100}
                        value={audioProgress}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        onMouseDown={handleProgressBarStart}
                        onChange={handleProgressBarChange}
                        onMouseUp={handleProgressBarEnd}
                        onTouchStart={handleProgressBarStart}
                        onTouchMove={handleProgressBarChange}
                        onTouchEnd={handleProgressBarEnd}
                      />
                    </div>
                    <span className="text-sm text-gray-500 min-w-[60px] text-right">
                      {formatTime(audioDuration)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;