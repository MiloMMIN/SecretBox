// app.js
import config from './config.js';

const FALLBACK_USER_NAME = '微信用户';
const FALLBACK_ANONYMOUS_NAME = '匿名用户';

function getBaseUrl() {
  return (config.baseUrl || '').replace(/\/+$/, '');
}

function getBaseOrigin() {
  return getBaseUrl().replace(/\/api$/, '');
}

function normalizeFileUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') {
    return '';
  }

  const normalized = fileUrl.trim();
  if (!normalized) {
    return '';
  }

  if (/^(https?:|wxfile:|data:)/i.test(normalized)) {
    return normalized;
  }

  const baseOrigin = getBaseOrigin();
  if (!baseOrigin) {
    return normalized;
  }

  if (normalized.startsWith('/api/')) {
    return `${baseOrigin}${normalized}`;
  }

  if (normalized.startsWith('/uploads/')) {
    return `${baseOrigin}/api${normalized}`;
  }

  if (normalized.startsWith('api/uploads/')) {
    return `${baseOrigin}/${normalized}`;
  }

  if (normalized.startsWith('uploads/')) {
    return `${baseOrigin}/api/${normalized}`;
  }

  if (normalized.startsWith('/')) {
    return `${baseOrigin}${normalized}`;
  }

  return normalized;
}

function normalizeDisplayUser(userInfo, fallbackName = FALLBACK_USER_NAME) {
  const nickName = userInfo?.nickName || userInfo?.nickname || fallbackName;

  return {
    ...(userInfo || {}),
    nickName,
    nickname: userInfo?.nickname || nickName,
    avatarUrl: normalizeFileUrl(userInfo?.avatarUrl || userInfo?.avatar_url || ''),
    role: userInfo?.role || 'student'
  };
}

function normalizeUserInfo(userInfo) {
  if (!userInfo) {
    return null;
  }

  return normalizeDisplayUser(userInfo, FALLBACK_USER_NAME);
}

function normalizeReply(reply) {
  return {
    ...(reply || {}),
    content: reply?.content || '',
    images: Array.isArray(reply?.images)
      ? reply.images.map((imageUrl) => normalizeFileUrl(imageUrl)).filter(Boolean)
      : [],
    user: normalizeDisplayUser(reply?.user, FALLBACK_USER_NAME)
  };
}

function normalizeQuestion(question) {
  if (!question) {
    return {
      user: normalizeDisplayUser(null, FALLBACK_ANONYMOUS_NAME),
      author: normalizeDisplayUser(null, FALLBACK_ANONYMOUS_NAME),
      replies: [],
      stars: 0,
      comments: 0,
      hasTeacherReply: false,
      latestReplyPreview: '',
      starred: false
    };
  }

  const fallbackName = question.isAnonymous ? FALLBACK_ANONYMOUS_NAME : FALLBACK_USER_NAME;
  const user = normalizeDisplayUser(question.user || question.author, fallbackName);
  const author = normalizeDisplayUser(question.author || question.user, fallbackName);

  return {
    ...question,
    user,
    author,
    replies: Array.isArray(question.replies) ? question.replies.map((reply) => normalizeReply(reply)) : [],
    stars: Number(question.stars || 0),
    comments: Number(question.comments || 0),
    hasTeacherReply: !!question.hasTeacherReply,
    latestReplyPreview: question.latestReplyPreview || '',
    starred: !!question.starred,
    reviewStatus: question.reviewStatus || 'approved',
    reviewStatusText: question.reviewStatusText || '',
    isPublic: !!question.isPublic
  };
}

function normalizeTeacherProfile(profile) {
  if (!profile) {
    return null;
  }

  return {
    ...profile,
    kind: profile.kind || 'teacher',
    nickName: profile.nickName || profile.nickname || (profile.kind === 'invite' ? '待激活教师' : '未命名教师'),
    avatarUrl: normalizeFileUrl(profile.avatarUrl || profile.avatar_url || ''),
    desc: profile.desc || profile.description || '',
    isActive: profile.isActive !== false,
    inviteCode: profile.inviteCode || profile.invite_code || '',
    claimed: !!profile.claimed
  };
}

App({
  normalizeFileUrl,
  normalizeQuestion,
  normalizeTeacherProfile,

  normalizeUserInfo(userInfo) {
    return normalizeUserInfo(userInfo);
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

  login(userInfo = {}) {
    const payloadUserInfo = {
      nickName: (userInfo.nickName || userInfo.nickname || '').trim()
    };

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
              userInfo: payloadUserInfo
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
        },
        fail: reject
      });
    });
  },

  globalData: {
    userInfo: null,
    isLoggedIn: false,
    baseUrl: getBaseUrl()
  }
});
