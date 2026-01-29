// pages/profile/profile.js
const app = getApp()

Page({
  data: {
    userInfo: {},
    hasUserInfo: false,
    myQuestions: [],
    myReplies: [],
    showMyQuestions: false,
    showMyReplies: false
  },

  onLoad() {
    this.setData({
      userInfo: app.globalData.userInfo || { nickName: '微信用户', avatarUrl: '', role: 'student' }
    });
  },

  onShow() {
    // 每次显示页面时更新用户信息（可能在其他地方修改了）
    if (app.globalData.userInfo) {
      this.setData({
        userInfo: app.globalData.userInfo
      });
    }
    
    // 如果已登录，加载数据
    if (app.globalData.isLoggedIn) {
      this.getMyQuestions();
      this.getMyReplies();
    }
  },

  // --- 头像昵称修改 ---
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    this.setData({
      'userInfo.avatarUrl': avatarUrl
    });
    // 同步到全局
    app.globalData.userInfo = { ...app.globalData.userInfo, avatarUrl };
    // TODO: 调用后端接口更新头像
    this.updateUserProfile();
  },

  onNicknameChange(e) {
    const nickName = e.detail.value;
    this.setData({
      'userInfo.nickName': nickName
    });
    // 同步到全局
    app.globalData.userInfo = { ...app.globalData.userInfo, nickName };
  },
  
  onNicknameBlur(e) {
      const nickName = e.detail.value;
      // 只有当昵称改变时才更新
      if (nickName !== app.globalData.userInfo?.nickName) {
          this.setData({
              'userInfo.nickName': nickName
          });
          app.globalData.userInfo = { ...app.globalData.userInfo, nickName };
          this.updateUserProfile();
      }
  },

  updateUserProfile() {
      // 模拟更新后端
      wx.showToast({
          title: '更新成功',
          icon: 'success'
      });
      // 实际开发中需调用 wx.request 更新服务器数据
  },

  // --- 列表展示 ---
  toggleMyQuestions() {
    this.setData({
      showMyQuestions: !this.data.showMyQuestions
    });
    if (this.data.showMyQuestions && this.data.myQuestions.length === 0) {
        this.getMyQuestions();
    }
  },

  toggleMyReplies() {
    this.setData({
      showMyReplies: !this.data.showMyReplies
    });
    if (this.data.showMyReplies && this.data.myReplies.length === 0) {
        this.getMyReplies();
    }
  },

  getMyQuestions() {
    // 模拟数据
    // 实际项目中应调用后端 API
    /*
    wx.request({
      url: `${app.globalData.baseUrl}/my/questions`,
      method: 'GET',
      header: { 'Authorization': wx.getStorageSync('token') },
      success: (res) => { ... }
    });
    */
   
   // Mock Data
   const mockQuestions = [
       { id: 1, content: '最近考研压力好大，不知道该怎么办...', time: '2023-10-20', reply: '同学你好，考研是一场持久战...' },
       { id: 2, content: '宿舍关系有点紧张，求支招', time: '2023-10-15', reply: null }
   ];
   this.setData({ myQuestions: mockQuestions });
  },

  getMyReplies() {
    // 模拟数据
    const mockReplies = [
        { id: 101, content: '抱抱你，一切都会好起来的！', time: '2023-10-21' }
    ];
    this.setData({ myReplies: mockReplies });
  },

  goToDetail(e) {
      // 如果需要跳转到详情页
      const id = e.currentTarget.dataset.id;
      // 这里的逻辑可以复用 index 页面的详情展示，或者跳转到一个独立的详情页
      // 目前简单提示
      wx.showToast({
          title: '查看详情: ' + id,
          icon: 'none'
      });
  },

  showInbox() {
    wx.showModal({
      title: '树洞信箱',
      content: '此处将显示分配给您的私密留言。支持查看学生真实身份（需二次确认）。',
      showCancel: false
    });
  },

  exportData() {
    wx.showLoading({ title: '生成报表中...' });
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({
        title: '导出成功(模拟)',
        icon: 'success'
      });
    }, 1500);
  }
})