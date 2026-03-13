const app = getApp();

Page({
  data: {
    questions: [],
    allQuestions: [],
    currentSort: 'time',
    searchKeyword: '',
    showLoginModal: false,
    userInfo: {
      avatarUrl: '',
      nickName: ''
    },
    // 详情页相关
    showDetail: false,
    currentQuestion: {},
    replyContent: ''
  },

  onLoad: function (options) {
    // 检查登录状态
    if (!app.globalData.isLoggedIn) {
      this.setData({ showLoginModal: true });
    } else {
      this.loadQuestions();
    }
  },

  onShow: function() {
    if (app.globalData.isLoggedIn) {
      this.loadQuestions();
    }
  },

  // --- 登录逻辑 ---
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    this.setData({
      'userInfo.avatarUrl': avatarUrl
    });
  },

  onNicknameChange(e) {
    this.setData({
      'userInfo.nickName': e.detail.value
    });
  },

  confirmLogin() {
    const { avatarUrl, nickName } = this.data.userInfo;
    if (!avatarUrl || !nickName) {
      wx.showToast({ title: '请完善信息', icon: 'none' });
      return;
    }
    
    wx.showLoading({ title: '登录中...' });
    app.login(this.data.userInfo).then(user => {
      wx.hideLoading();
      this.setData({ showLoginModal: false });
      wx.showToast({ title: '欢迎回来', icon: 'success' });
      this.loadQuestions();
    }).catch(err => {
      wx.hideLoading();
      console.error(err);
      wx.showToast({
        title: typeof err === 'string' ? err : '登录失败',
        icon: 'none'
      });
    });
  },

  loadQuestions: function() {
    wx.request({
      url: `${app.globalData.baseUrl}/questions`,
      method: 'GET',
      data: {
        search: this.data.searchKeyword,
        sort: this.data.currentSort
      },
      success: (res) => {
        if (res.statusCode === 200) {
          this.setData({ questions: res.data });
        }
      }
    });
  },

  // ... 之前的排序和搜索逻辑 ...
  changeSort: function(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ currentSort: type }, () => {
        this.loadQuestions();
    });
  },

  onSearchInput: function(e) {
    this.setData({ searchKeyword: e.detail.value });
  },

  onSearch: function() {
    this.loadQuestions();
  },

  // --- 详情页逻辑 ---
  goToDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    console.log('点击查看详情，ID:', id); // 调试日志
    this.fetchQuestionDetail(id);
  },

  fetchQuestionDetail(id) {
    wx.showLoading({ title: '加载中' });
    wx.request({
      url: `${app.globalData.baseUrl}/questions/${id}`,
      method: 'GET',
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode === 200) {
          this.setData({
            currentQuestion: res.data,
            showDetail: true
          });
        }
      }
    });
  },

  onDetailClose() {
    this.setData({ showDetail: false });
  },

  onReplyInput(e) {
    this.setData({ replyContent: e.detail.value });
  },

  submitReply() {
    if (!this.data.replyContent.trim()) {
      wx.showToast({ title: '请输入内容', icon: 'none' });
      return;
    }
    
    const qid = this.data.currentQuestion.id;
    wx.showLoading({ title: '发送中' });
    
    wx.request({
      url: `${app.globalData.baseUrl}/questions/${qid}/replies`,
      method: 'POST',
      header: {
        'Authorization': wx.getStorageSync('token')
      },
      data: {
        content: this.data.replyContent
      },
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode === 200) {
          wx.showToast({ title: '回复成功', icon: 'success' });
          this.setData({ replyContent: '' });
          // 刷新详情
          this.fetchQuestionDetail(qid);
        } else {
            wx.showToast({ title: '回复失败', icon: 'none' });
        }
      }
    });
  },

  onTapPost: function() {
    console.log('onTapPost triggered');
    if (!app.globalData.isLoggedIn) {
      console.log('User not logged in, showing modal');
      this.setData({ showLoginModal: true });
      return;
    }
    console.log('Navigating to square post page');
    wx.navigateTo({
      url: '/pages/square_post/index',
      success: () => {
        console.log('Navigate success');
      },
      fail: (err) => {
        console.error('Navigate failed:', err);
        wx.showToast({
          title: '无法跳转',
          icon: 'none'
        });
      }
    });
  }
})
