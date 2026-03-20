// pages/post/create.js
const app = getApp();

Page({
  data: {
    counselorId: null,
    counselorName: '',
    counselorAvatar: '',
    counselorAvatarText: '',
    userAvatar: '',
    userAvatarText: '我',
    content: '',
    isAnonymous: false,
    isPublic: false,
    studentClass: '',
    studentName: '',
    loadingConversation: false,
    conversationItems: [],
    conversationAnchorId: '',
    showConversationDialog: false
  },

  onLoad: function (options) {
    const userInfo = app.globalData.userInfo || {};
    this.setData({
      counselorId: options.counselorId,
      counselorName: decodeURIComponent(options.counselorName || '教师'),
      counselorAvatar: decodeURIComponent(options.counselorAvatar || ''),
      counselorAvatarText: decodeURIComponent(options.counselorAvatarText || '教'),
      userAvatar: userInfo.avatarUrl || '',
      userAvatarText: (userInfo.nickName || '我').slice(0, 1)
    }, () => {
      this.loadConversation(true);
    });
  },

  onShow() {
    const userInfo = app.globalData.userInfo || {};
    this.setData({
      userAvatar: userInfo.avatarUrl || this.data.userAvatar,
      userAvatarText: (userInfo.nickName || this.data.userAvatarText || '我').slice(0, 1)
    });
    if (this.data.counselorId !== null) {
      this.loadConversation(false);
    }
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

  loadConversation(applyDefaults = false) {
    const token = wx.getStorageSync('token');
    if (!token || this.data.counselorId === null) {
      return;
    }

    this.setData({ loadingConversation: true });
    wx.request({
      url: `${app.globalData.baseUrl}/my/conversations/${this.data.counselorId}`,
      method: 'GET',
      header: {
        Authorization: token
      },
      success: (res) => {
        if (res.statusCode === 200) {
          const payload = res.data || {};
          const items = (payload.items || []).map((item) => ({
            ...item,
            domId: `msg-${item.id}`
          }));
          const defaults = payload.defaults || {};
          const nextData = {
            conversationItems: items,
            conversationAnchorId: items.length ? items[items.length - 1].domId : ''
          };

          if (applyDefaults) {
            nextData.isAnonymous = !!defaults.isAnonymous;
            nextData.studentClass = defaults.studentClass || this.data.studentClass;
            nextData.studentName = defaults.studentName || this.data.studentName;
          }

          this.setData(nextData);
          return;
        }

        wx.showToast({
          title: res.data?.error || '对话记录加载失败',
          icon: 'none'
        });
      },
      fail: () => {
        wx.showToast({
          title: '对话记录加载失败',
          icon: 'none'
        });
      },
      complete: () => {
        this.setData({ loadingConversation: false });
      }
    });
  },

  previewConversationImage(e) {
    const url = e.currentTarget.dataset.url;
    const urls = e.currentTarget.dataset.urls || [];
    if (!url || !urls.length) {
      return;
    }

    wx.previewImage({
      current: url,
      urls
    });
  },

  openConversationDialog() {
    if (!this.data.conversationItems.length) {
      return;
    }

    this.setData({
      showConversationDialog: true
    });
  },

  closeConversationDialog() {
    this.setData({
      showConversationDialog: false
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

          if (!this.data.isPublic) {
            this.setData({
              content: ''
            });
            this.loadConversation(false);
            return;
          }

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
