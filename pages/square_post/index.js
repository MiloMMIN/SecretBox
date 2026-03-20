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

    const token = wx.getStorageSync('token');
    if (!token) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      });
      return;
    }

    this.setData({ loading: true });

    wx.request({
      url: `${app.globalData.baseUrl}/questions`,
      method: 'POST',
      header: {
        'Authorization': token
      },
      data: {
        content: this.data.content.trim(),
        isAnonymous: this.data.isAnonymous,
        isPublic: true,
        counselorId: 0
      },
      success: (res) => {
        this.setData({ loading: false });

        if (res.statusCode === 200 && res.data.success) {
          wx.showToast({
            title: res.data.reviewStatus === 'pending' ? '已提交审核' : '发布成功',
            icon: 'success'
          });

          const pages = getCurrentPages();
          const prevPage = pages[pages.length - 2];
          if (prevPage && prevPage.loadQuestions) {
            prevPage.loadQuestions();
          }

          setTimeout(() => {
            wx.navigateBack();
          }, 800);
          return;
        }

        wx.showToast({
          title: res.data?.error || '发布失败',
          icon: 'none'
        });
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({
          title: '网络错误，请稍后重试',
          icon: 'none'
        });
      }
    });
  }
})