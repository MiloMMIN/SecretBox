// pages/profile/profile.js
const app = getApp()

function normalizeUserInfo(userInfo) {
  if (!userInfo) {
    return { nickName: '微信用户', avatarUrl: '', role: 'student' };
  }

  return {
    ...userInfo,
    nickName: userInfo.nickName || userInfo.nickname || '微信用户',
    avatarUrl: userInfo.avatarUrl || userInfo.avatar_url || '',
    role: userInfo.role || 'student'
  };
}

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
      userInfo: normalizeUserInfo(app.globalData.userInfo)
    });
  },

  onShow() {
    // 每次显示页面时更新用户信息（可能在其他地方修改了）
    if (app.globalData.userInfo) {
      this.setData({
        userInfo: normalizeUserInfo(app.globalData.userInfo)
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
    this.updateUserProfile();
  },

  onNicknameChange(e) {
    const nickName = e.detail.value;
    this.setData({
      'userInfo.nickName': nickName
    });
  },
  
  onNicknameBlur(e) {
      const nickName = (e.detail.value || '').trim();
      const currentNickName = normalizeUserInfo(app.globalData.userInfo).nickName;

      this.setData({
        'userInfo.nickName': nickName || currentNickName
      });

      if (nickName && nickName !== currentNickName) {
        this.updateUserProfile();
      }
  },

  updateUserProfile() {
      const token = wx.getStorageSync('token');
      if (!token) {
        wx.showToast({
          title: '请先登录',
          icon: 'none'
        });
        return;
      }

      const payload = {
        nickName: (this.data.userInfo.nickName || '').trim(),
        avatarUrl: this.data.userInfo.avatarUrl || ''
      };

      wx.request({
        url: `${app.globalData.baseUrl}/me/profile`,
        method: 'PUT',
        header: {
          'Authorization': token
        },
        data: payload,
        success: (res) => {
          if (res.statusCode === 200 && res.data.success) {
            const userInfo = normalizeUserInfo(res.data.userInfo);
            this.setData({ userInfo });
            app.globalData.userInfo = userInfo;
            wx.showToast({
              title: '更新成功',
              icon: 'success'
            });
            return;
          }

          wx.showToast({
            title: res.data?.error || '更新失败',
            icon: 'none'
          });
        },
        fail: () => {
          wx.showToast({
            title: '网络错误，请稍后重试',
            icon: 'none'
          });
        }
      });
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
    wx.request({
      url: `${app.globalData.baseUrl}/my/questions`,
      method: 'GET',
      header: { 'Authorization': wx.getStorageSync('token') },
      success: (res) => {
        if (res.statusCode === 200) {
          this.setData({ myQuestions: res.data || [] });
          return;
        }

        wx.showToast({
          title: res.data?.error || '加载提问失败',
          icon: 'none'
        });
      },
      fail: () => {
        wx.showToast({
          title: '提问记录加载失败',
          icon: 'none'
        });
      }
    });
  },

  getMyReplies() {
    wx.request({
      url: `${app.globalData.baseUrl}/my/replies`,
      method: 'GET',
      header: { 'Authorization': wx.getStorageSync('token') },
      success: (res) => {
        if (res.statusCode === 200) {
          const myReplies = (res.data || []).map((item) => ({
            ...item,
            content: item.content || item.my_reply || ''
          }));
          this.setData({ myReplies });
          return;
        }

        wx.showToast({
          title: res.data?.error || '加载回复失败',
          icon: 'none'
        });
      },
      fail: () => {
        wx.showToast({
          title: '回复记录加载失败',
          icon: 'none'
        });
      }
    });
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