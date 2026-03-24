// pages/post/create.js
const app = getApp();

Page({
  data: {
    counselorId: null,
    counselorName: '',
    content: '',
    isAnonymous: false,
    isPublic: false,
    studentClass: '',
    studentName: ''
  },

  onLoad: function (options) {
    this.setData({
      counselorId: options.counselorId,
      counselorName: options.counselorName || '教师'
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

  onClassInput: function(e) {
    this.setData({ studentClass: e.detail.value });
  },

  onNameInput: function(e) {
    this.setData({ studentName: e.detail.value });
  },

  submitPost: function() {
    if (!this.data.content.trim()) {
      wx.showToast({
        title: '请输入内容',
        icon: 'none'
      });
      return;
    }

    // 实名校验
    if (!this.data.isAnonymous) {
      if (!this.data.studentClass.trim() || !this.data.studentName.trim()) {
        wx.showToast({
          title: '请填写真实班级和姓名',
          icon: 'none'
        });
        return;
      }
    }

    wx.showLoading({
      title: '投递中...',
    });

    const token = wx.getStorageSync('token');
    if (!token) {
      wx.hideLoading();
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      });
      return;
    }

    wx.request({
      url: `${app.globalData.baseUrl}/questions`,
      method: 'POST',
      header: {
        'Authorization': token
      },
      data: {
        content: this.data.content.trim(),
        counselorId: this.data.counselorId,
        isAnonymous: this.data.isAnonymous,
        isPublic: this.data.isPublic,
        studentClass: this.data.studentClass.trim(),
        studentName: this.data.studentName.trim()
      },
      success: (res) => {
        wx.hideLoading();

        if (res.statusCode === 200 && res.data.success) {
          wx.showToast({
            title: res.data.reviewStatus === 'pending' ? '已提交审核' : '投递成功',
            icon: 'success'
          });

          setTimeout(() => {
            wx.switchTab({
              url: '/pages/index/index'
            });
          }, 800);
          return;
        }

        wx.showToast({
          title: res.data?.error || '投递失败',
          icon: 'none'
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({
          title: '网络错误，请稍后重试',
          icon: 'none'
        });
      }
    });
  }
})
