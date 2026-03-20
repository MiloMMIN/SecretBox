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

function isLocalAvatarPath(path) {
  if (!path || typeof path !== 'string') {
    return false;
  }

  return path.startsWith('wxfile://') || path.startsWith('http://tmp/') || path.startsWith('https://tmp/') || path.startsWith('/tmp/');
}

App({
  onLaunch() {
    this.checkLogin();
  },

  checkLogin() {
    const token = wx.getStorageSync('token');
    const cachedUserInfo = wx.getStorageSync('userInfo');
    if (!token) {
      // 未登录，引导去授权
      // 由于 onLaunch 是异步的，这里通常不做强制跳转，而是在页面 onShow 检查
      // 或者设置全局标记
      this.globalData.isLoggedIn = false;
    } else {
      this.globalData.isLoggedIn = true;
      if (cachedUserInfo) {
        this.globalData.userInfo = normalizeUserInfo(cachedUserInfo);
      }
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
          wx.setStorageSync('userInfo', this.globalData.userInfo);
          this.refreshTeacherNotificationBadge();
          return;
        }

        if (response.statusCode === 401) {
          wx.removeStorageSync('token');
          wx.removeStorageSync('userInfo');
          this.globalData.userInfo = null;
          this.globalData.isLoggedIn = false;
          wx.removeTabBarBadge({ index: 2 });
        }
      }
    });
  },

  refreshTeacherNotificationBadge() {
    const token = wx.getStorageSync('token');
    const userInfo = this.globalData.userInfo;
    if (!token || !userInfo || userInfo.role !== 'teacher') {
      wx.removeTabBarBadge({ index: 2 });
      return;
    }

    wx.request({
      url: `${this.globalData.baseUrl}/teacher/dashboard`,
      method: 'GET',
      header: {
        'Authorization': token
      },
      success: (response) => {
        if (response.statusCode === 200 && response.data?.unreadCount > 0) {
          wx.setTabBarBadge({
            index: 2,
            text: String(Math.min(response.data.unreadCount, 99))
          });
          return;
        }

        wx.removeTabBarBadge({ index: 2 });
      }
    });
  },

  getAuthHeader() {
    const token = wx.getStorageSync('token');
    return token ? { Authorization: token } : {};
  },

  compressAvatarIfNeeded(filePath) {
    return new Promise((resolve, reject) => {
      wx.getFileInfo({
        filePath,
        success: (info) => {
          if (info.size <= 200 * 1024) {
            resolve(filePath);
            return;
          }

          wx.compressImage({
            src: filePath,
            quality: info.size > 1024 * 1024 ? 45 : 60,
            success: (compressRes) => {
              resolve(compressRes.tempFilePath || filePath);
            },
            fail: reject
          });
        },
        fail: reject
      });
    });
  },

  uploadAvatar(filePath) {
    return new Promise((resolve, reject) => {
      const token = wx.getStorageSync('token');
      if (!token) {
        reject(new Error('未登录，无法上传头像'));
        return;
      }

      this.compressAvatarIfNeeded(filePath).then((compressedPath) => {
        wx.getFileInfo({
          filePath: compressedPath,
          success: (info) => {
            if (info.size > 512 * 1024) {
              reject(new Error('头像压缩后仍大于 512KB，请重新选择图片'));
              return;
            }

            wx.uploadFile({
              url: `${this.globalData.baseUrl}/uploads/image?purpose=avatar`,
              filePath: compressedPath,
              name: 'file',
              header: {
                Authorization: token
              },
              success: (uploadRes) => {
                let data = {};
                try {
                  data = JSON.parse(uploadRes.data || '{}');
                } catch (error) {
                  reject(error);
                  return;
                }

                if (uploadRes.statusCode === 200 && data.success && data.url) {
                  resolve(data.url);
                  return;
                }

                reject(new Error(data.error || '头像上传失败'));
              },
              fail: reject
            });
          },
          fail: reject
        });
      }).catch(reject);
    });
  },

  updateCurrentUserProfile(payload) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${this.globalData.baseUrl}/me/profile`,
        method: 'PUT',
        header: this.getAuthHeader(),
        data: payload,
        success: (response) => {
          if (response.statusCode === 200 && response.data?.success) {
            const userInfo = normalizeUserInfo(response.data.userInfo);
            this.globalData.userInfo = userInfo;
            wx.setStorageSync('userInfo', userInfo);
            resolve(userInfo);
            return;
          }

          reject(new Error(response.data?.error || '更新资料失败'));
        },
        fail: reject
      });
    });
  },

  syncAvatarAfterLogin(userInfo) {
    if (!isLocalAvatarPath(userInfo?.avatarUrl)) {
      return Promise.resolve(this.globalData.userInfo);
    }

    return this.uploadAvatar(userInfo.avatarUrl).then((remoteAvatarUrl) => this.updateCurrentUserProfile({
      nickName: userInfo.nickName || this.globalData.userInfo?.nickName || '',
      avatarUrl: remoteAvatarUrl
    }));
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
                  wx.setStorageSync('userInfo', this.globalData.userInfo);
                  this.syncAvatarAfterLogin(userInfo).then((finalUserInfo) => {
                    this.refreshTeacherNotificationBadge();
                    resolve(finalUserInfo || this.globalData.userInfo);
                  }).catch(() => {
                    this.refreshTeacherNotificationBadge();
                    resolve(this.globalData.userInfo);
                  });
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
