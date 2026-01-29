const app = getApp();

Page({
  data: {
    content: '',
    contentLength: 0,
    isAnonymous: false,
    loading: false
  },

  onContentInput(e) {
    const val = e.detail.value;
    this.setData({
      content: val,
      contentLength: val.length
    });
  },

  onAnonymousChange(e) {
    this.setData({
      isAnonymous: e.detail.value
    });
  },

  submitPost() {
    if (!this.data.content.trim()) {
      wx.showToast({
        title: '请输入问题内容',
        icon: 'none'
      });
      return;
    }

    this.setData({ loading: true });

    // 模拟网络请求
    // 实际项目中应替换为 wx.request 调用后端 API
    setTimeout(() => {
      this.setData({ loading: false });
      
      wx.showToast({
        title: '发布成功',
        icon: 'success',
        duration: 2000
      });

      // 延迟返回，让用户看到成功提示
      setTimeout(() => {
        // 返回上一页并刷新（如果是 navigateTo 进来的）
        // 或者跳转回广场（如果是 switchTab）
        // 这里假设是从广场页 navigateTo 进来的，所以 navigateBack
        // 但通常发布后最好回到列表页并刷新
        
        // 获取页面栈，调用上一个页面的刷新方法
        const pages = getCurrentPages();
        const prevPage = pages[pages.length - 2];
        if (prevPage && prevPage.loadQuestions) {
          prevPage.loadQuestions();
        }

        wx.navigateBack();
      }, 1500);

    }, 1000);
  }
})