// pages/post/create.js
Page({
  data: {
    counselorId: null,
    counselorName: '',
    content: '',
    isAnonymous: false,
    isPublic: false
  },

  onLoad: function (options) {
    this.setData({
      counselorId: options.counselorId,
      counselorName: options.counselorName || '辅导员'
    });
  },

  onContentInput: function(e) {
    this.setData({
      content: e.detail.value
    });
  },

  onAnonymousChange: function(e) {
    this.setData({
      isAnonymous: e.detail.value
    });
  },

  onPublicChange: function(e) {
    this.setData({
      isPublic: e.detail.value
    });
  },

  submitPost: function() {
    if (!this.data.content.trim()) {
      wx.showToast({
        title: '请输入内容',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({
      title: '投递中...',
    });

    // 模拟网络请求
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({
        title: '投递成功',
        icon: 'success',
        duration: 2000,
        success: () => {
          setTimeout(() => {
            wx.switchTab({
              url: '/pages/index/index',
            });
          }, 2000);
        }
      });
    }, 1500);
  }
})
