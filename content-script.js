// 全局配置
const CONFIG = {
    minTextLength: 10, // 最小翻译文本长度
    batchSize: 5,      // 每批翻译的段落数量
    debounceTime: 150, // 防抖时间(ms)
    excludeTags: ['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'NOSCRIPT', 'SVG'],
    observerThreshold: 0.1, // 元素有10%进入视口就触发
    observerRootMargin: '300px', // 视口外300px预加载区域
    selectors: 'p, h1, h2, h3, h4, h5, h6, div > span:not(.translation-text), li:not(:has(> ul, > ol))'
};

// 存储已处理节点的集合
const processedNodes = new WeakSet();
// 存储翻译结果缓存
const translationCache = new Map();
// 存储观察器目标
const observedNodes = new WeakSet();
// 存储等待翻译的节点
const pendingNodes = new Map();
// 正在处理的批次数
let activeBatches = 0;
// 最大并行批次数
const MAX_PARALLEL_BATCHES = 4;

// 主函数
async function initTranslator() {
    console.log('[Inline Translator] 初始化...');

    if (document.readyState !== 'complete') {
        window.addEventListener('load', initTranslator);
        console.log('[Inline Translator] 页面完全加载');
        return;
    }

    const settings = await getSettings();
    if (!settings.enabled) {
        console.log('[Inline Translator] 插件已被用户禁用');
        return;
    }

    setupIntersectionObserver();
    observeDOMChanges();
}

// 设置 Intersection Observer
function setupIntersectionObserver() {
    const observerOptions = {
        root: null,
        rootMargin: CONFIG.observerRootMargin,
        threshold: CONFIG.observerThreshold
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const element = entry.target;
                observer.unobserve(element);
                element.dataset.translationScanned = "true";

                const paragraphNodes = extractParagraphs(element);
                if (paragraphNodes.length > 0) {
                    paragraphNodes.forEach(node => {
                        if (!pendingNodes.has(node) && !processedNodes.has(node)) {
                            pendingNodes.set(node, 'pending');
                        }
                    });
                    processPendingNodes();
                }

                setTimeout(() => {
                    if (element && element.isConnected && !element.dataset.translationCompleted) {
                        observer.observe(element);
                    }
                }, 5000);
            }
        });
    }, observerOptions);

    const elementsToObserve = document.querySelectorAll(CONFIG.selectors);
    elementsToObserve.forEach(element => {
        if (!element.dataset.translationScanned &&
            !element.classList.contains('translation-wrapper') &&
            !element.classList.contains('translation-text') &&
            !observedNodes.has(element)) {
            observer.observe(element);
            observedNodes.add(element);
        }
    });

    window.translationObserver = observer;
}

// 处理等待队列中的节点
function processPendingNodes() {
    if (pendingNodes.size === 0 || activeBatches >= MAX_PARALLEL_BATCHES) {
        return;
    }

    const batch = [];
    let count = 0;

    for (const [node, status] of pendingNodes.entries()) {
        if (status === 'pending') {
            batch.push(node);
            pendingNodes.set(node, 'processing');
            count++;
            if (count >= CONFIG.batchSize) break;
        }
    }

    if (batch.length > 0) {
        activeBatches++;
        processBatch(batch)
            .then(() => {
                batch.forEach(node => pendingNodes.delete(node));
            })
            .catch(error => {
                console.error('[Inline Translator] 批处理错误:', error);
                batch.forEach(node => {
                    if (pendingNodes.has(node)) {
                        pendingNodes.set(node, 'pending');
                    }
                });
            })
            .finally(() => {
                activeBatches--;
                setTimeout(processPendingNodes, 10);
            });
    }
}

// 提取段落节点（修改后的核心函数）
function extractParagraphs(node) {
    // 如果节点已处理或标记为完成，直接返回空数组
    if (processedNodes.has(node) ||
        (node.nodeType === Node.ELEMENT_NODE && node.dataset.translationCompleted === "true")) {
        return [];
    }

    // 只处理元素节点
    if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();

        // 排除不需要翻译的标签或已翻译的内容
        if (CONFIG.excludeTags.includes(tagName.toUpperCase()) ||
            node.classList.contains('translation-wrapper') ||
            node.classList.contains('translation-text') ||
            node.closest('.translation-wrapper')) {
            return [];
        }

        // 提取节点的纯文本内容
        const textContent = node.textContent.trim();

        // 如果文本长度足够且为英文，则将该节点作为翻译单元
        if (textContent.length >= CONFIG.minTextLength && isEnglishContent(textContent)) {
            return [node];
        } else {
            // 如果当前节点不满足条件，递归检查其子节点
            const results = [];
            const childNodes = Array.from(node.childNodes);
            for (const childNode of childNodes) {
                const childParagraphs = extractParagraphs(childNode);
                results.push(...childParagraphs);
            }
            return results;
        }
    }

    // 非元素节点（如文本节点）不直接处理，返回空数组
    return [];
}

// 判断是否为英文内容
function isEnglishContent(text) {
    const englishRatio = (text.match(/[a-zA-Z]/g) || []).length / text.length;
    return englishRatio > 0.5;
}

// 批处理段落节点
async function processBatch(paragraphNodes) {
    const textsToTranslate = [];
    const nodeMapping = [];

    for (const node of paragraphNodes) {
        if (processedNodes.has(node) || node.dataset.translationCompleted === "true") {
            continue;
        }

        const textContent = node.textContent.trim();
        if (translationCache.has(textContent)) {
            insertTranslation(node, translationCache.get(textContent));
            processedNodes.add(node);
            node.dataset.translationCompleted = "true";
        } else {
            textsToTranslate.push(textContent);
            nodeMapping.push(node);
        }
    }

    if (textsToTranslate.length === 0) return;

    try {
        const translatedTexts = await sendTranslationRequest(textsToTranslate);
        for (let i = 0; i < translatedTexts.length; i++) {
            const originalText = textsToTranslate[i];
            const translatedText = translatedTexts[i];
            const targetNode = nodeMapping[i];

            if (processedNodes.has(targetNode)) continue;

            translationCache.set(originalText, translatedText);
            insertTranslation(targetNode, translatedText);
            processedNodes.add(targetNode);
            targetNode.dataset.translationCompleted = "true";
        }
        return Promise.resolve();
    } catch (error) {
        console.error('[Inline Translator] 翻译错误:', error);
        nodeMapping.forEach(node => {
            if (!processedNodes.has(node)) {
                pendingNodes.set(node, 'pending');
            }
        });
        return Promise.reject(error);
    }
}

// 发送翻译请求
async function sendTranslationRequest(texts) {
    console.log('[Inline Translator] 发送翻译请求，内容如下：');
    texts.forEach((text, index) => {
        console.log(`  [${index + 1}] ${text}`);
    });

    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { action: 'translate', texts, source: 'en', target: 'zh-CN' },
            response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (response && response.error) {
                    reject(new Error(response.error));
                } else if (response && response.translations) {
                    resolve(response.translations);
                } else {
                    reject(new Error('无效的翻译响应'));
                }
            }
        );
    });
}
// 插入翻译
function insertTranslation(node, translatedText) {
    if (!node || !node.parentNode || processedNodes.has(node)) return;

    // 创建翻译文本的容器，使用与原文相同的标签以保持结构一致性
    const translationElement = document.createElement(node.tagName || 'div');
    translationElement.className = 'translation-wrapper';
    translationElement.textContent = translatedText;

    // 获取原文节点的计算样式
    const computedStyle = window.getComputedStyle(node);

    // 定义需要复制的样式属性
    const stylesToCopy = [
        'font-family',   // 字体
        'font-size',     // 字号
        'font-weight',   // 字体粗细
        'font-style',    // 字体样式（如斜体）
        'color',         // 文字颜色
        'line-height',   // 行高
        'text-align',    // 文本对齐方式
        'margin',        // 外边距
        'padding'        // 内边距
    ];

    // 将原文节点的样式应用到翻译文本容器
    stylesToCopy.forEach(style => {
        translationElement.style[style] = computedStyle.getPropertyValue(style);
    });

    // 设置唯一的ID
    const uniqueId = `trans-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    translationElement.dataset.translationId = uniqueId;
    processedNodes.add(translationElement);

    // 插入到原文节点后面
    if (node.nextSibling) {
        node.parentNode.insertBefore(translationElement, node.nextSibling);
    } else {
        node.parentNode.appendChild(translationElement);
    }
}

// 监听 DOM 变化
function observeDOMChanges() {
    const observer = new MutationObserver(debounce(mutations => {
        const elementsToObserve = new Set();

        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (shouldObserveElement(node)) {
                        elementsToObserve.add(node);
                    }
                    if (node.querySelectorAll) {
                        const matches = node.querySelectorAll(CONFIG.selectors);
                        matches.forEach(match => {
                            if (shouldObserveElement(match)) {
                                elementsToObserve.add(match);
                            }
                        });
                    }
                }
            });

            if (mutation.type === 'attributes' && mutation.target.nodeType === Node.ELEMENT_NODE) {
                const node = mutation.target;
                if (shouldObserveElement(node)) {
                    elementsToObserve.add(node);
                }
            }
        });

        if (elementsToObserve.size > 0) {
            console.log(`[Inline Translator] 检测到 ${elementsToObserve.size} 个新元素需要观察`);
            elementsToObserve.forEach(element => {
                if (!observedNodes.has(element)) {
                    window.translationObserver.observe(element);
                    observedNodes.add(element);
                }
            });
        }
    }, CONFIG.debounceTime));

    function shouldObserveElement(element) {
        return !element.dataset.translationScanned &&
               !element.dataset.translationCompleted &&
               !element.classList.contains('translation-wrapper') &&
               !element.classList.contains('translation-text') &&
               !CONFIG.excludeTags.includes(element.tagName) &&
               !element.closest('.translation-wrapper') &&
               !observedNodes.has(element) &&
               (element.matches && element.matches(CONFIG.selectors));
    }

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
    });
}

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// 获取用户设置
async function getSettings() {
    return new Promise(resolve => {
        chrome.storage.local.get({
            enabled: true,
            minTextLength: 10
        }, settings => {
            CONFIG.minTextLength = settings.minTextLength;
            resolve(settings);
        });
    });
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateSettings') {
        if (message.settings.hasOwnProperty('enabled')) {
            if (message.settings.enabled) {
                setupIntersectionObserver();
            }
        }
        if (message.settings.hasOwnProperty('minTextLength')) {
            CONFIG.minTextLength = message.settings.minTextLength;
        }
    } else if (message.action === 'translatePage') {
        window.processedNodes = new WeakSet();
        pendingNodes.clear();

        document.querySelectorAll('[data-translation-scanned]').forEach(el => {
            delete el.dataset.translationScanned;
        });
        document.querySelectorAll('[data-translation-completed]').forEach(el => {
            delete el.dataset.translationCompleted;
        });
        document.querySelectorAll('[data-translation-id]').forEach(el => {
            delete el.dataset.translationId;
        });
        document.querySelectorAll('.translation-wrapper').forEach(el => {
            el.remove();
        });

        console.log('[Inline Translator] 重新翻译页面');
        window.observedNodes = new WeakSet();
        setupIntersectionObserver();
    }
});

// 初始化
initTranslator();