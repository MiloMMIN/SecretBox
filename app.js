// app.js
import config from './config.js';

function trimTrailingSlash(value) {
  return (value || '').replace(/\/+$/, '');
}

function getBaseOrigin() {
  return trimTrailingSlash(config.baseUrl).replace(/\/api$/i, '');
}

function isLocalHost(hostname) {
  if (!hostname) {
    return false;
  }

  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.startsWith('10.')
    || hostname.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function preferHttpsUrl(url) {
  if (!/^http:\/\//i.test(url)) {
    return url;
  }

  const match = url.match(/^http:\/\/([^\/?#]+)/i);
  const hostname = ((match && match[1]) || '').split(':')[0].toLowerCase();
  if (isLocalHost(hostname)) {
    return url;
  }

  return `https://${url.slice('http://'.length)}`;
}

function normalizeFileUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') {
    return '';
  }

  const normalized = fileUrl.trim();
  if (!normalized) {
    return '';
  }

  if (
    normalized.startsWith('wxfile://')
    || normalized.startsWith('http://tmp/')
    || normalized.startsWith('https://tmp/')
    || normalized.startsWith('/tmp/')
  ) {
    return normalized;
  }

  const baseOrigin = getBaseOrigin();
  if (normalized.startsWith('/api/uploads/')) {
    return preferHttpsUrl(`${baseOrigin}${normalized}`);
  }
  if (normalized.startsWith('/uploads/')) {
    return preferHttpsUrl(`${baseOrigin}/api${normalized}`);
  }
  if (normalized.startsWith('uploads/')) {
    return preferHttpsUrl(`${baseOrigin}/api/${normalized}`);
  }

  return preferHttpsUrl(normalized);
}

function normalizeDisplayUser(userInfo, options = {}) {
  const allowTeacherAvatar = options.allowTeacherAvatar === true;
  const role = userInfo?.role || 'student';
  const fallbackName = role === 'teacher' ? '教师用户' : '微信用户';
  const nickName = userInfo?.nickName || userInfo?.nickname || fallbackName;
  const nickname = userInfo?.nickname || nickName;
  const avatarUrl = allowTeacherAvatar && role === 'teacher'
    ? normalizeFileUrl(userInfo?.avatarUrl || userInfo?.avatar_url || '')
    : '';

  return {
    ...(userInfo || {}),
    nickName,
    nickname,
    avatarUrl,
    role
  };
}

function normalizeUserInfo(userInfo) {
  if (!userInfo) {
    return null;
  }

  return normalizeDisplayUser(userInfo);
}

function normalizeReply(reply) {
  return {
    ...(reply || {}),
    content: reply?.content || '',
    images: Array.isArray(reply?.images) ? reply.images.map((item) => normalizeFileUrl(item)).filter(Boolean) : [],
    user: normalizeDisplayUser(reply?.user, { allowTeacherAvatar: true })
  };
}

function normalizeQuestion(question) {
  const normalizedReplies = Array.isArray(question?.replies)
    ? question.replies.map((reply) => normalizeReply(reply))
    : [];

  return {
    ...(question || {}),
    content: question?.content || '',
    time: question?.time || '',
    stars: Number(question?.stars || 0),
    comments: Number(question?.comments || normalizedReplies.length || 0),
    hasTeacherReply: !!question?.hasTeacherReply,
    latestReplyPreview: question?.latestReplyPreview || question?.reply || '',
    isPublic: !!question?.isPublic,
    reviewStatus: question?.reviewStatus || 'pending',
    reviewStatusText: question?.reviewStatusText || '',
    starred: !!question?.starred,
    user: normalizeDisplayUser(question?.user || question?.author, { allowTeacherAvatar: true }),
    author: normalizeDisplayUser(question?.author || question?.user, { allowTeacherAvatar: true }),
    replies: normalizedReplies
  };
}

function normalizeTeacherProfile(profile) {
  return {
    ...(profile || {}),
    kind: profile?.kind || 'teacher',
    id: profile?.id ?? null,
    nickName: profile?.nickName || profile?.display_name || '未命名教师',
    avatarUrl: normalizeFileUrl(profile?.avatarUrl || profile?.avatar_url || ''),
    desc: profile?.desc || profile?.description || '',
    isActive: profile?.isActive !== false,
    inviteCode: profile?.inviteCode || profile?.invite_code || '',
    claimed: !!profile?.claimed
  };
}

App({
  normalizeFileUrl(fileUrl) {
    return normalizeFileUrl(fileUrl);
  },

  normalizeUserInfo(userInfo) {
    return normalizeUserInfo(userInfo);
  },

  normalizeQuestion(question) {
    return normalizeQuestion(question);
  },

  normalizeTeacherProfile(profile) {
    return normalizeTeacherProfile(profile);
  },

  onLaunch() {
    this.checkLogin();
  },

  checkLogin() {
    const token = wx.getStorageSync('token');
    const cachedUserInfo = wx.getStorageSync('userInfo');
    if (!token) {
      this.globalData.isLoggedIn = false;
      return;
    }

    this.globalData.isLoggedIn = true;
    if (cachedUserInfo) {
      this.globalData.userInfo = normalizeUserInfo(cachedUserInfo);
    }
    this.fetchCurrentUser();
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
        Authorization: token
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
        Authorization: token
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

  updateCurrentUserProfile(payload) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${this.globalData.baseUrl}/me/profile`,
        method: 'PUT',
        header: this.getAuthHeader(),
        data: {
          nickName: (payload?.nickName || payload?.nickname || '').trim()
        },
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

  login(userInfo) {
    const nickName = (userInfo?.nickName || userInfo?.nickname || '').trim();
    return new Promise((resolve, reject) => {
      wx.login({
        success: (res) => {
          if (!res.code) {
            reject(`登录失败！${res.errMsg}`);
            return;
          }

          wx.request({
            url: `${this.globalData.baseUrl}/login`,
            method: 'POST',
            data: {
              code: res.code,
              userInfo: {
                nickName
              }
            },
            success: (response) => {
              if (response.statusCode === 200) {
                const { token, userInfo: serverUser } = response.data;
                wx.setStorageSync('token', token);
                this.globalData.userInfo = normalizeUserInfo(serverUser);
                this.globalData.isLoggedIn = true;
                wx.setStorageSync('userInfo', this.globalData.userInfo);
                this.refreshTeacherNotificationBadge();
                resolve(this.globalData.userInfo);
                return;
              }

              reject(response.data?.error || '登录失败');
            },
            fail: reject
          });
        }
      });
    });
  },

  globalData: {
    userInfo: null,
    isLoggedIn: false,
    baseUrl: config.baseUrl
  }
});
