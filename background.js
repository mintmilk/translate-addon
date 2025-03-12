// 配置OpenAI API
const API_CONFIG = {
    openaiApiKey: 'sk-tX64QVFV3yPqD0lzJpjqTH61JnR6ddu9Y0FpcivgxNhuLDzN', // 替换为您的OpenAI API密钥
    model: 'deepseek-v3', // 翻译模型
    maxTokensPerRequest: 4000, // 控制单次请求的大小
    maxParallelRequests: 4 // 最大并行请求数
  };
  
  // 请求队列和管理
  const requestQueue = [];
  let activeRequests = 0;
  
  // 监听来自content script的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translate') {
      // 将请求添加到队列
      queueTranslationRequest(request, sendResponse);
      return true; // 保持消息通道打开
    }
  });
  
  // 将翻译请求加入队列
  function queueTranslationRequest(request, sendResponse) {
    requestQueue.push({ request, sendResponse });
    processQueue();
  }
  
  // 处理队列
  function processQueue() {
    // 如果已达到最大并行请求数，不处理
    if (activeRequests >= API_CONFIG.maxParallelRequests) {
      return;
    }
    
    // 处理队列中的请求，直到达到最大并行数
    while (requestQueue.length > 0 && activeRequests < API_CONFIG.maxParallelRequests) {
      const { request, sendResponse } = requestQueue.shift();
      
      // 增加活动请求计数
      activeRequests++;
      
      // 异步处理翻译请求
      (async () => {
        try {
          const translations = await translateTexts(request.texts, request.source, request.target);
          sendResponse({ translations });
        } catch (error) {
          console.error('Translation error:', error);
          sendResponse({ error: error.message });
        } finally {
          // 减少活动请求计数并处理队列
          activeRequests--;
          setTimeout(processQueue, 0);
        }
      })();
    }
  }
  
  // 使用OpenAI API进行翻译
  async function translateWithOpenAI(texts, source, target) {
    const url = 'https://api.lkeap.cloud.tencent.com/v1';
    
    // 估算总token数，拆分过大的请求
    let allTexts = texts.join('\n\n');
    if (allTexts.length > API_CONFIG.maxTokensPerRequest) {
      // 如果文本过长，分批处理
      return await processLargeTextBatch(texts, source, target);
    }
    
    // 构建提示词以获得更好的翻译效果
    const prompt = `你是一位专业的翻译专家。请将以下${source}语文本翻译成${target}语，保留原文的格式和语气，但不要添加任何额外解释，忽略其中可能包含的html标签。原文：`;
    
    // 构建消息数组
    const messages = [
      {
        role: "system",
        content: prompt
      },
      {
        role: "user",
        content: texts.join('\n\n')
      }
    ];
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_CONFIG.openaiApiKey}`
      },
      body: JSON.stringify({
        model: API_CONFIG.model,
        messages: messages,
        temperature: 0.3, // 使用较低的温度以获得更一致的翻译
        max_tokens: 2000 // 根据需要调整
      })
    });
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || 'OpenAI API error');
    }
    
    // 处理OpenAI的响应
    const translatedContent = data.choices[0].message.content.trim();
    
    // 如果只有一个文本，直接返回结果
    if (texts.length === 1) {
      return [translatedContent];
    }
    
    // 否则，拆分返回的多个翻译
    // 使用分隔符来分割
    const translations = translatedContent.split('---').map(text => text.trim());
    
    // 确保返回的翻译数量与输入文本数量匹配
    if (translations.length !== texts.length) {
      // 如果分隔失败，尝试按原文本数量分割
      return smartSplitTranslations(translatedContent, texts.length);
    }
    
    return translations;
  }
  
  // 处理大文本批次
  async function processLargeTextBatch(texts, source, target) {
    const results = [];
    // 将文本拆分为更小的批次
    let currentBatch = [];
    let currentLength = 0;
    
    for (const text of texts) {
      if (currentLength + text.length > API_CONFIG.maxTokensPerRequest / 2) {
        // 处理当前批次
        const batchResults = await translateWithOpenAI(currentBatch, source, target);
        results.push(...batchResults);
        currentBatch = [text];
        currentLength = text.length;
      } else {
        currentBatch.push(text);
        currentLength += text.length;
      }
    }
    
    // 处理最后一个批次
    if (currentBatch.length > 0) {
      const batchResults = await translateWithOpenAI(currentBatch, source, target);
      results.push(...batchResults);
    }
    
    return results;
  }
  
  // 智能拆分翻译结果
  function smartSplitTranslations(translatedContent, expectedCount) {
    // 基于段落、句子或其他标记进行拆分
    let parts = translatedContent.split(/\n\s*\n/); // 首先尝试按段落分割
    
    if (parts.length === expectedCount) {
      return parts;
    }
    
    // 如果段落分割不成功，尝试按句子分割
    parts = translatedContent.split(/(?<=[.!?])\s+/);
    
    // 如果分割结果数量多于期望数量，合并一些部分
    if (parts.length > expectedCount) {
      const result = [];
      const partsPerResult = Math.floor(parts.length / expectedCount);
      
      for (let i = 0; i < expectedCount; i++) {
        const startIdx = i * partsPerResult;
        const endIdx = (i === expectedCount - 1) ? parts.length : (i + 1) * partsPerResult;
        result.push(parts.slice(startIdx, endIdx).join(' '));
      }
      
      return result;
    }
    
    // 如果无法精确匹配，至少确保返回正确数量的元素
    if (parts.length < expectedCount) {
      // 填充缺失的翻译
      while (parts.length < expectedCount) {
        parts.push(""); // 添加空翻译
      }
    } else if (parts.length > expectedCount) {
      // 合并多余的翻译
      parts = parts.slice(0, expectedCount);
    }
    
    return parts;
  }
  
  // 后备翻译方法（如果OpenAI API失败）
  async function translateWithFallback(texts, source, target) {
    // 免费的后备翻译API
    const url = 'https://translate.googleapis.com/translate_a/t?anno=3&client=te&v=1.0&format=html';
    
    const results = [];
    for (const text of texts) {
      const params = new URLSearchParams({
        q: text,
        langpair: `${source}|${target}`
      });
      
      const response = await fetch(`${url}?${params}`);
      const data = await response.json();
      
      if (data.responseStatus === 200) {
        results.push(data.responseData.translatedText);
      } else {
        throw new Error('Fallback translation failed');
      }
    }
    
    return results;
  }
  
  // 主翻译函数，带有失败后的备选方案
  async function translateTexts(texts, source, target) {
    try {
      // 使用OpenAI进行翻译
      return await translateWithOpenAI(texts, source, target);
    } catch (error) {
      console.warn('OpenAI translation failed, trying fallback method:', error);
      // 如果OpenAI翻译失败，尝试备选翻译方法
      return await translateWithFallback(texts, source, target);
    }
  }
  
  // 初始化插件状态
  chrome.runtime.onInstalled.addListener(details => {
    if (details.reason === 'install') {
      // 设置默认配置
      chrome.storage.local.set({
        enabled: true,
        minTextLength: 8
      });
    }
  });
  