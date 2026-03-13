// app.js
import config from './config.js';

function normalizeUserInfo(userInfo) {
  if (!userInfo) {
    return null;
  }

  return {
    ...userInfo,
    nickName: userInfo.nickName || userInfo.nickname || '微信用户',
    avatarUrl: userInfo.avatarUrl || userInfo.avatar_url || '',
    role: userInfo.role || 'student'
  };
}

App({
  onLaunch() {
    this.checkLogin();
  },

  checkLogin() {
    const token = wx.getStorageSync('token');
    if (!token) {
      // 未登录，引导去授权
      // 由于 onLaunch 是异步的，这里通常不做强制跳转，而是在页面 onShow 检查
      // 或者设置全局标记
      this.globalData.isLoggedIn = false;
    } else {
      this.globalData.isLoggedIn = true;
      this.fetchCurrentUser();
    }
  },

  fetchCurrentUser() {
    const token = wx.getStorageSync('token');
    if (!token) {
      return;
    }

    wx.request({
      url: `${this.globalData.baseUrl}/me`,
      method: 'GET',
      header: {
        'Authorization': token
      },
      success: (response) => {
        if (response.statusCode === 200) {
          this.globalData.userInfo = normalizeUserInfo(response.data);
          this.globalData.isLoggedIn = true;
          return;
        }

        if (response.statusCode === 401) {
          wx.removeStorageSync('token');
          this.globalData.userInfo = null;
          this.globalData.isLoggedIn = false;
        }
      }
    });
  },

  login(userInfo) {
    return new Promise((resolve, reject) => {
      wx.login({
        success: res => {
          if (res.code) {
            wx.request({
              url: `${this.globalData.baseUrl}/login`,
              method: 'POST',
              data: {
                code: res.code,
                userInfo: userInfo
              },
              success: (response) => {
                if (response.statusCode === 200) {
                  const { token, userInfo: serverUser } = response.data;
                  wx.setStorageSync('token', token);
                  this.globalData.userInfo = normalizeUserInfo(serverUser);
                  this.globalData.isLoggedIn = true;
                  resolve(this.globalData.userInfo);
                } else {
                  reject(response.data.error);
                }
              },
              fail: (err) => {
                reject(err);
              }
            });
          } else {
            reject('登录失败！' + res.errMsg);
          }
        }
      });
    });
  },

  globalData: {
    userInfo: null,
    isLoggedIn: false,
    baseUrl: config.baseUrl
  }
})
