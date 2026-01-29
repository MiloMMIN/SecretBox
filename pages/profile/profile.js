// pages/profile/profile.js
const app = getApp()

Page({
  data: {
    userInfo: {},
    hasUserInfo: false
  },

  onLoad() {
    this.setData({
      userInfo: app.globalData.userInfo
    })
  },

  switchRole() {
    const currentRole = this.data.userInfo.role;
    const newRole = currentRole === 'student' ? 'teacher' : 'student';
    const newUserInfo = { ...this.data.userInfo, role: newRole };
    
    app.globalData.userInfo = newUserInfo;
    this.setData({
      userInfo: newUserInfo
    });
    
    wx.showToast({
      title: `已切换为${newRole === 'student' ? '学生' : '辅导员'}`,
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
