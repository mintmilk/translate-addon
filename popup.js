document.addEventListener('DOMContentLoaded', () => {
    // 获取DOM元素
    const enabledCheckbox = document.getElementById('enabled');
    const minTextLengthSlider = document.getElementById('minTextLength');
    const minTextLengthValue = document.getElementById('minTextLengthValue');
    const translationModelSelect = document.getElementById('translationModel');
    const translateVisibleButton = document.getElementById('translateVisible');
    const statusElement = document.getElementById('status');
    
    // 加载设置
    chrome.storage.local.get({
      enabled: true,
      minTextLength: 8,
      translationModel: 'deepseek-v3'
    }, settings => {
      enabledCheckbox.checked = settings.enabled;
      minTextLengthSlider.value = settings.minTextLength;
      minTextLengthValue.textContent = settings.minTextLength;
      translationModelSelect.value = settings.translationModel;
    });
    
    // 监听启用/禁用切换
    enabledCheckbox.addEventListener('change', () => {
      const enabled = enabledCheckbox.checked;
      chrome.storage.local.set({ enabled });
      
      // 通知当前页面更新设置
      sendMessageToActiveTab({ action: 'updateSettings', settings: { enabled } });
      
      showStatus(enabled ? '翻译已启用' : '翻译已禁用');
    });
    
    // 监听最小文本长度改变
    minTextLengthSlider.addEventListener('input', () => {
      const minTextLength = parseInt(minTextLengthSlider.value);
      minTextLengthValue.textContent = minTextLength;
      chrome.storage.local.set({ minTextLength });
      
      // 通知当前页面更新设置
      sendMessageToActiveTab({ action: 'updateSettings', settings: { minTextLength } });
    });
    
    // 监听翻译模型改变
    translationModelSelect.addEventListener('change', () => {
      const translationModel = translationModelSelect.value;
      chrome.storage.local.set({ translationModel });
      showStatus(`已选择 ${translationModel} 模型`);
    });
    
    // 翻译可见区域按钮
    translateVisibleButton.addEventListener('click', () => {
      sendMessageToActiveTab({ action: 'translatePage' });
      showStatus('正在翻译可见区域...');
    });
    
    // 向当前标签页发送消息
    function sendMessageToActiveTab(message) {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, message);
        }
      });
    }
    
    // 显示状态信息
    function showStatus(message) {
      statusElement.textContent = message;
      setTimeout(() => {
        statusElement.textContent = '';
      }, 3000);
    }
  });
  