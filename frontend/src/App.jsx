import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// 工具函数：将 Base64 字符串转换为 Uint8Array
function base64ToUint8Array(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const CONTENT_DB_NAME = 'easyReaderDB';
const CONTENT_STORE_NAME = 'contentStore';
const CONTENT_CACHE_KEY = 'currentNovelContent';

function openContentDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONTENT_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CONTENT_STORE_NAME)) {
        db.createObjectStore(CONTENT_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveContentToDb(content) {
  const db = await openContentDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONTENT_STORE_NAME, 'readwrite');
    const store = tx.objectStore(CONTENT_STORE_NAME);
    store.put(content, CONTENT_CACHE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function readContentFromDb() {
  const db = await openContentDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONTENT_STORE_NAME, 'readonly');
    const store = tx.objectStore(CONTENT_STORE_NAME);
    const request = store.get(CONTENT_CACHE_KEY);
    request.onsuccess = () => resolve(request.result || '');
    request.onerror = () => reject(request.error);
  });
}

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
  const [audioElement, setAudioElement] = useState(null);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  // 分段音频状态
  const [audioSegments, setAudioSegments] = useState([]);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [totalAudioDuration, setTotalAudioDuration] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const isDraggingRef = useRef(false);
  const currentSegmentIndexRef = useRef(0);
  const audioSegmentsRef = useRef([]);
  const ttsAbortControllerRef = useRef(null);
  const chapterListRef = useRef(null);
  const chapterItemRefs = useRef(new Map());
  const shouldScrollToCurrentChapterRef = useRef(false);

  // 从正文中提取章节；若未识别到标准章节，则回退为“全文”
  const extractChapters = (content) => {
    if (!content) return [];

    const chapterPatterns = [
      // 中文章节（覆盖“零/〇/两”和阿拉伯数字）
      /^\s*第\s*[零〇○一二三四五六七八九十百千万两\d]+\s*[章节回卷篇][^\n\r]{0,40}$/gm,
      // 英文章节
      /^\s*chapter\s+\d+[^\n\r]{0,40}$/gim,
      // 常见数字标题，如 "401. xxx"、"401、xxx"
      /^\s*\d+\s*[.、]\s*[^\n\r]{1,40}$/gm,
    ];

    const detectedChapters = [];

    chapterPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const startPos = match.index;
        const chapterTitle = match[0].trim() || `第 ${detectedChapters.length + 1} 章`;
        detectedChapters.push({ id: startPos, title: chapterTitle, start: startPos });
      }
    });

    // 去重并排序
    const uniqueChapters = [...new Map(detectedChapters.map((ch) => [ch.id, ch])).values()];
    uniqueChapters.sort((a, b) => a.start - b.start);

    if (uniqueChapters.length === 0) {
      return [{
        id: 0,
        title: '全文',
        start: 0,
        end: content.length
      }];
    }

    // 添加结束位置
    return uniqueChapters.map((ch, index) => ({
      ...ch,
      end: index < uniqueChapters.length - 1 ? uniqueChapters[index + 1].start : content.length
    }));
  };

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  useEffect(() => {
    currentSegmentIndexRef.current = currentSegmentIndex;
  }, [currentSegmentIndex]);

  useEffect(() => {
    audioSegmentsRef.current = audioSegments;
  }, [audioSegments]);

  // 初始化音频元素和加载缓存
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';

    const handleTimeUpdate = () => {
      if (isDraggingRef.current || isNaN(audio.currentTime)) {
        return;
      }
      const segments = audioSegmentsRef.current;
      if (segments.length > 0) {
        const elapsed = segments
          .slice(0, currentSegmentIndexRef.current)
          .reduce((sum, segment) => sum + (segment.duration || 0), 0);
        setAudioProgress(elapsed + audio.currentTime);
      } else {
        setAudioProgress(audio.currentTime);
      }
    };
    
    // 监听播放进度
    audio.addEventListener('timeupdate', handleTimeUpdate);
    
    // 监听时长变化
    const handleDurationChange = () => {
      if (!isNaN(audio.duration)) {
        setAudioDuration(audio.duration);
      }
    };
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));
    
    setAudioElement(audio);
    
    // 尝试加载缓存的文件
    const loadCachedFile = async () => {
      try {
        const cachedData = localStorage.getItem('easyReaderCachedFile');
        if (cachedData) {
          const {
            novelContent: legacyNovelContent,
            novelTitle,
            chapters,
            currentChapterIndex,
            bookmarks
          } = JSON.parse(cachedData);
          const restoredContent = legacyNovelContent || await readContentFromDb();
          
          if (restoredContent && novelTitle) {
            // 兼容旧缓存：若正文仍在 localStorage，迁移到 IndexedDB
            if (legacyNovelContent) {
              await saveContentToDb(legacyNovelContent);
            }
            const restoredChapters = Array.isArray(chapters) && chapters.length > 0
              ? chapters
              : extractChapters(restoredContent);

            setNovelContent(restoredContent);
            setNovelTitle(novelTitle);
            setChapters(restoredChapters);
            setBookmarks(bookmarks || []);
            setShowUpload(false);
            
            // 设置当前章节
            if (restoredChapters.length > 0) {
              const safeIndex = Number.isInteger(currentChapterIndex)
                ? Math.min(Math.max(currentChapterIndex, 0), restoredChapters.length - 1)
                : 0;
              setCurrentChapter(restoredChapters[safeIndex]);
              shouldScrollToCurrentChapterRef.current = true;
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
      if (ttsAbortControllerRef.current) {
        ttsAbortControllerRef.current.abort();
        ttsAbortControllerRef.current = null;
      }
      if (audio) {
        audio.pause();
        audio.src = '';
        // 移除事件监听器
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('durationchange', handleDurationChange);
      }
    };
  }, []);

  // 处理文件上传
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      setIsUploading(true);
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
      const response = await fetch('http://localhost:5001/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('上传文件失败');
      }
      const data = await response.json();

      if (data.success) {
        const content = data.content;
        setNovelContent(content);
        await saveContentToDb(content);
        detectChapters(content);
        setShowUpload(false);
      } else {
        throw new Error(data.error || '处理文件失败');
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      alert(`上传文件失败: ${error.message}`);
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  // 检测章节
  const detectChapters = (content) => {
    const chaptersWithEnd = extractChapters(content);
    
    setChapters(chaptersWithEnd);
    if (chaptersWithEnd.length > 0) {
      setCurrentChapter(chaptersWithEnd[0]);
    }
  };

  // 跳转到章节
  const jumpToChapter = (chapter) => {
    // 切换章节时中断当前转语音请求，避免旧章节继续生成
    if (ttsAbortControllerRef.current) {
      ttsAbortControllerRef.current.abort();
      ttsAbortControllerRef.current = null;
      setIsGenerating(false);
    }

    // 切换章节时清理旧播放上下文，避免旧章节音频继续影响新章节
    if (currentChapter?.id !== chapter.id) {
      if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
      }
      audioSegments.forEach((segment) => URL.revokeObjectURL(segment.url));
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      setAudioSegments([]);
      setAudioUrl(null);
      setCurrentSegmentIndex(0);
      setTotalAudioDuration(0);
      setAudioProgress(0);
      setAudioDuration(0);
      setIsPlaying(false);
    }
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
      // 如果已有进行中的转语音，先终止旧任务
      if (ttsAbortControllerRef.current) {
        ttsAbortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      ttsAbortControllerRef.current = abortController;

      // 清理上一次生成的对象 URL，避免内存泄漏
      audioSegments.forEach((segment) => URL.revokeObjectURL(segment.url));
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }

      setIsGenerating(true);
      setAudioSegments([]);
      setCurrentSegmentIndex(0);
      setTotalAudioDuration(0);
      setAudioUrl(null);
      setAudioDuration(0);
      setAudioProgress(0);
      if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
      }
      
      let chapterText = novelContent.substring(currentChapter.start, currentChapter.end);
      
      console.log('开始流式生成音频，文本长度:', chapterText.length);
      
      // 发送请求到后端流式 API
      const response = await fetch('http://localhost:5001/api/tts/stream', {
        method: 'POST',
        signal: abortController.signal,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: chapterText,
          speed: 0,
          volume: 0,
          voice: 'zh-CN-YunxiNeural',
          segment_size: 450,
          first_segment_size: 220
        })
      });
      
      if (!response.ok) {
        throw new Error('生成音频失败');
      }
      
      // 处理流式 SSE 响应：收到一个分段就立即可播放
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let startedPlayback = false;
      let receivedSegments = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        
        buffer += decoder.decode(value, { stream: true });
        
        // 解析 SSE 事件块
        const events = buffer.split('\n\n');
        buffer = events.pop(); // 保留不完整事件
        
        for (const rawEvent of events) {
          if (!rawEvent.trim()) continue;

          const lines = rawEvent.split('\n');
          let eventName = 'message';
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataStr += line.slice(5).trim();
            }
          }

          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (eventName === 'progress') {
              console.log(`生成进度: ${data.current}/${data.total} (${data.percentage}%)`);
            } else if (eventName === 'segment') {
              const audioBytes = base64ToUint8Array(data.audio_base64);
              const blob = new Blob([audioBytes], { type: 'audio/mpeg' });
              const url = URL.createObjectURL(blob);

              // 预读取分段时长，便于进度条按总时长显示
              const segmentDuration = await new Promise((resolve) => {
                const tempAudio = new Audio(url);
                tempAudio.onloadedmetadata = () => resolve(isNaN(tempAudio.duration) ? 0 : tempAudio.duration);
                tempAudio.onerror = () => resolve(0);
              });

              const segment = { url, duration: segmentDuration };
              setAudioSegments((prev) => [...prev, segment]);
              setTotalAudioDuration((prev) => prev + segmentDuration);
              receivedSegments += 1;

              // 首段到达后立即播放，显著降低等待感
              if (!startedPlayback && audioElement) {
                audioElement.src = url;
                await audioElement.play();
                startedPlayback = true;
              }
            } else if (eventName === 'error') {
              throw new Error(data.message || '流式生成失败');
            } else if (eventName === 'complete') {
              console.log('音频分段生成完成');
            }
          } catch (error) {
            console.error('解析服务器数据失败:', error);
          }
        }
      }

      if (receivedSegments === 0) {
        throw new Error('未收到可播放音频分段');
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }
      console.error('Error generating audio:', error);
      alert('生成音频失败，请确保后端服务正在运行');
    } finally {
      if (ttsAbortControllerRef.current) {
        ttsAbortControllerRef.current = null;
      }
      setIsGenerating(false);
    }
  };

  // 播放/暂停音频
  const togglePlay = () => {
    if (!audioElement || (audioSegments.length === 0 && !audioUrl)) return;
    
    if (isPlaying) {
      audioElement.pause();
    } else {
      // 检查是否使用分段音频
      if (audioSegments.length > 0) {
        // 如果已暂停则继续播放；仅在没有音源时设置当前分段
        if (!audioElement.src) {
          audioElement.src = audioSegments[currentSegmentIndex].url;
        }
        audioElement.play().catch((error) => {
          console.error('播放失败:', error);
        });
      } else if (audioUrl) {
        // 兼容旧的单个音频播放
        audioElement.play().catch((error) => {
          console.error('播放失败:', error);
        });
      }
    }
  };

  // 停止音频
  const stopAudio = () => {
    if (!audioElement) return;
    
    audioElement.pause();
    audioElement.currentTime = 0;
    setAudioProgress(0);
    setIsPlaying(false);
    // 重置分段音频状态
    setCurrentSegmentIndex(0);
  };
  
  // 处理进度条拖动开始
  const handleProgressBarStart = () => {
    setIsDragging(true);
  };
  
  // 处理进度条拖动
  const handleProgressBarChange = (e) => {
    if (!audioElement || (!audioDuration && !totalAudioDuration)) return;
    
    const value = parseFloat(e.target.value);
    setAudioProgress(value);
  };
  
  // 处理进度条拖动结束
  const handleProgressBarEnd = () => {
    if (!audioElement || (!audioDuration && !totalAudioDuration)) return;
    
    // 检查是否使用分段音频
    if (audioSegments.length > 0 && totalAudioDuration > 0) {
      // 计算目标总进度
      const targetProgress = audioProgress;
      
      // 确定应该跳转到哪个分段
      let accumulatedDuration = 0;
      let targetSegmentIndex = 0;
      let targetSegmentTime = 0;
      
      for (let i = 0; i < audioSegments.length; i++) {
        const segment = audioSegments[i];
        if (targetProgress <= accumulatedDuration + segment.duration) {
          targetSegmentIndex = i;
          targetSegmentTime = targetProgress - accumulatedDuration;
          break;
        }
        accumulatedDuration += segment.duration;
      }
      
      // 跳转到目标分段和时间
      setCurrentSegmentIndex(targetSegmentIndex);
      audioElement.src = audioSegments[targetSegmentIndex].url;
      audioElement.currentTime = targetSegmentTime;
      
      if (isPlaying) {
        audioElement.play();
      }
    } else if (audioDuration > 0) {
      // 兼容旧的单个音频播放
      audioElement.currentTime = audioProgress;
    }
    
    setIsDragging(false);
  };

  // 监听音频播放结束
  useEffect(() => {
    if (audioElement) {
      audioElement.onended = () => {
        // 检查是否有更多分段需要播放
        if (currentSegmentIndex < audioSegments.length - 1) {
          // 播放下一个分段
          const nextIndex = currentSegmentIndex + 1;
          setCurrentSegmentIndex(nextIndex);
          audioElement.src = audioSegments[nextIndex].url;
          audioElement.play().catch((error) => {
            console.error('播放下一个分段失败:', error);
          });
        } else {
          // 所有分段播放完成
          setIsPlaying(false);
          setCurrentSegmentIndex(0);
        }
      };
    }
  }, [audioElement, currentSegmentIndex, audioSegments]);
  
  // 缓存文件内容和状态
  useEffect(() => {
    // 只有当有小说内容时才缓存
    if (novelContent && novelTitle) {
      try {
        const currentChapterIndex = chapters.findIndex(ch => ch.id === currentChapter?.id);
        const cacheData = {
          novelTitle,
          chapters,
          currentChapterIndex: currentChapterIndex >= 0 ? currentChapterIndex : 0,
          bookmarks
        };
        
        // 将数据存储到 localStorage
        localStorage.setItem('easyReaderCachedFile', JSON.stringify(cacheData));
      } catch {
        // localStorage 容量不足时，至少保证标题/当前章节可恢复，避免功能失效
        try {
          const currentChapterIndex = chapters.findIndex(ch => ch.id === currentChapter?.id);
          localStorage.setItem('easyReaderCachedFile', JSON.stringify({
            novelTitle,
            currentChapterIndex: currentChapterIndex >= 0 ? currentChapterIndex : 0
          }));
        } catch (fallbackError) {
          console.error('Error caching file:', fallbackError);
        }
      }
    }
  }, [novelContent, novelTitle, chapters, currentChapter, bookmarks]);

  // 刷新恢复后，自动将章节列表滚动到当前章节
  useEffect(() => {
    if (!shouldScrollToCurrentChapterRef.current || !currentChapter) return;
    if (!chapterListRef.current || chapters.length === 0) return;

    const activeItem = chapterItemRefs.current.get(currentChapter.id);
    if (!activeItem) return;

    requestAnimationFrame(() => {
      activeItem.scrollIntoView({
        block: 'center',
        behavior: 'auto'
      });
      shouldScrollToCurrentChapterRef.current = false;
    });
  }, [chapters, currentChapter]);

  // 渲染章节内容
  const renderChapterContent = () => {
    if (!currentChapter || !novelContent) return '';
    
    const content = novelContent.substring(currentChapter.start, currentChapter.end);
    // 将文本按段落分割并渲染
    return content.split('\n').map((paragraph, index) => (
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
    <div className="app-shell flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* 隐藏的文件输入框 - 始终存在于DOM中 */}
      <input
        id="file-upload"
        type="file"
        accept=".txt"
        className="hidden"
        onChange={handleFileUpload}
        disabled={isUploading}
      />
      
      {/* 顶部导航栏 */}
      <header className="top-bar bg-white shadow-md z-10 border-b border-slate-200/70">
        <div className="container px-3 py-2 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <i className="fa fa-book text-blue-600 text-xl"></i>
            <h1 className="text-lg font-bold text-gray-800">Easy Reader</h1>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="flex-1 flex overflow-hidden">
        {/* 左侧导航栏 - 固定宽度 */}
        <div className="w-[280px] shrink-0 bg-gray-50 border-r border-gray-200 overflow-y-auto">
          <div>
            <div className="content-card bg-white rounded-lg shadow-md p-3 mb-4">
              <h2 className="text-base font-semibold mb-3 flex items-center">
                <i className="fa fa-folder-open text-blue-600 mr-2"></i>
                章节导航
              </h2>
              <div className="border rounded-md overflow-hidden">
                <div className="p-1.5 bg-gray-50 border-b">
                  <input 
                    type="text" 
                    placeholder="搜索章节..." 
                    className="w-full px-2.5 py-1 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div ref={chapterListRef} className="max-h-[calc(100vh-220px)] overflow-y-auto p-1.5">
                  {isUploading ? (
                    <div className="text-center text-gray-500 py-3 text-sm">
                      <i className="fa fa-spinner fa-spin mr-2"></i>
                      正在解析文件...
                    </div>
                  ) : chapters.length > 0 ? (
                    chapters.map((chapter) => (
                      <div
                        key={chapter.id}
                        className={`chapter-item p-1.5 rounded-md text-sm ${currentChapter?.id === chapter.id ? 'active' : ''}`}
                        ref={(el) => {
                          if (el) {
                            chapterItemRefs.current.set(chapter.id, el);
                          } else {
                            chapterItemRefs.current.delete(chapter.id);
                          }
                        }}
                        onClick={() => jumpToChapter(chapter)}
                      >
                        {chapter.title}
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-gray-500 py-3 text-sm">
                      请先上传小说文件
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="content-card bg-white rounded-lg shadow-md p-3">
              <h2 className="text-base font-semibold mb-3 flex items-center">
                <i className="fa fa-bookmark text-blue-600 mr-2"></i>
                书签管理
              </h2>
              <div className="max-h-56 overflow-y-auto p-1.5">
                {bookmarks.length > 0 ? (
                  bookmarks.map((bookmark) => (
                    <div
                      key={bookmark.id}
                      className="p-1.5 rounded-md hover:bg-gray-50"
                      onClick={() => jumpToBookmark(bookmark)}
                    >
                      <div className="font-medium text-sm">{bookmark.chapterTitle}</div>
                      <div className="text-xs text-gray-500">{bookmark.timestamp}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-gray-500 py-3 text-sm">
                    暂无书签
                  </div>
                )}
              </div>
              <div className="mt-3 flex justify-between gap-2">
                <button 
                  className="btn-primary px-2.5 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={addBookmark}
                  disabled={!currentChapter}
                >
                  <i className="fa fa-plus mr-1"></i> 添加书签
                </button>
                <button 
                  className="btn-secondary px-2.5 py-1 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className="flex-1 overflow-y-auto">
          {/* 文件上传区 */}
          {showUpload ? (
            <div className="content-card bg-white rounded-lg shadow-md p-5 mb-4 text-center">
              <div className="mb-3">
                <i className="fa fa-cloud-upload text-gray-400 text-4xl"></i>
              </div>
              <h2 className="text-lg font-semibold mb-2">上传小说文件</h2>
              <p className="text-gray-600 text-sm mb-3">支持 .txt 文件，自动检测编码格式</p>
              <div className="flex justify-center">
                <label
                  htmlFor="file-upload"
                  className={`btn-primary px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md ${
                    isUploading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-blue-700 cursor-pointer'
                  }`}
                >
                  {isUploading ? (
                    <>
                      <i className="fa fa-spinner fa-spin mr-2"></i> 上传中...
                    </>
                  ) : (
                    <>
                      <i className="fa fa-file-text-o mr-2"></i> 选择文件
                    </>
                  )}
                </label>
              </div>
            </div>
          ) : (
            <>
              {/* 阅读区 */}
              <div className="content-card bg-white rounded-lg shadow-md p-4 mb-4">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-lg font-semibold text-gray-800">{novelTitle}</h2>
                  <div className="flex items-center space-x-3">
                    {currentChapter && (
                      <span className="text-xs text-gray-500">
                        {chapters.indexOf(currentChapter) + 1} / {chapters.length}
                      </span>
                    )}
                    <button 
                      className="btn-primary px-2.5 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => {
                        // 触发文件输入点击
                        document.getElementById('file-upload').click();
                      }}
                      disabled={isUploading}
                    >
                      {isUploading ? (
                        <>
                          <i className="fa fa-spinner fa-spin mr-1"></i> 上传中
                        </>
                      ) : (
                        <>
                          <i className="fa fa-upload mr-1"></i> 重新上传
                        </>
                      )}
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
        <div className="player-bar bg-white border-t border-gray-200 px-3 py-2.5 shadow-md z-10">
          <div className="container">
            <div className="audio-control flex items-center justify-between">
              <div className="flex items-center space-x-2.5 flex-wrap gap-y-1.5">
                <h3 className="font-semibold text-sm flex items-center">
                  <i className="fa fa-volume-up text-blue-600 mr-2"></i>
                  语音朗读
                </h3>
                <button 
                  className="btn-primary px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={generateAudio}
                  disabled={!currentChapter || isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <i className="fa fa-spinner fa-spin mr-2"></i> 生成中...
                    </>
                  ) : (
                    <>
                      <i className="fa fa-play mr-2"></i> 开始朗读
                    </>
                  )}
                </button>
                <button 
                  className="btn-secondary px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={togglePlay}
                  disabled={(audioSegments.length === 0 && !audioUrl)}
                >
                  <i className={isPlaying ? "fa fa-pause mr-2" : "fa fa-play mr-2"}></i>
                  {isPlaying ? '暂停' : '播放'}
                </button>
                <button 
                  className="btn-secondary px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={stopAudio}
                  disabled={(audioSegments.length === 0 && !audioUrl)}
                >
                  <i className="fa fa-stop mr-2"></i> 停止
                </button>
              </div>
              {(audioUrl || audioSegments.length > 0) && (
                <div className="flex-1 max-w-xl mx-4 min-w-[220px]">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-gray-500 min-w-[52px]">
                      {formatTime(audioProgress)}
                    </span>
                    <div className="flex-1">
                      <input
                        type="range"
                        min="0"
                        max={audioSegments.length > 0 ? totalAudioDuration : (audioDuration || 100)}
                        value={audioProgress}
                        className="audio-slider w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        onMouseDown={handleProgressBarStart}
                        onChange={handleProgressBarChange}
                        onMouseUp={handleProgressBarEnd}
                        onTouchStart={handleProgressBarStart}
                        onTouchMove={handleProgressBarChange}
                        onTouchEnd={handleProgressBarEnd}
                      />
                    </div>
                    <span className="text-xs text-gray-500 min-w-[52px] text-right">
                      {formatTime(audioSegments.length > 0 ? totalAudioDuration : audioDuration)}
                    </span>
                  </div>
                  {audioSegments.length > 0 && (
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      第 {currentSegmentIndex + 1}/{audioSegments.length} 段
                    </div>
                  )}
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