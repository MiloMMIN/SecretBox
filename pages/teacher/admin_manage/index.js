var app = getApp();

function normalizeUserInfo(userInfo) {
  var normalized = typeof app.normalizeUserInfo === 'function'
    ? app.normalizeUserInfo(userInfo)
    : userInfo;

  normalized = normalized || {};

  var adminLevel = normalized.adminLevel || normalized.admin_level || 'none';
  var hasAdminAccess = typeof app.hasAdminAccess === 'function'
    ? app.hasAdminAccess(normalized)
    : (adminLevel === 'admin' || adminLevel === 'super_admin');

  return {
    role: normalized.role || 'student',
    adminLevel: adminLevel,
    hasAdminAccess: hasAdminAccess
  };
}

function canManageAdminPage(userInfo) {
  return !!(userInfo && userInfo.hasAdminAccess);
}

function buildApplications(items, reviewingId) {
  var sourceItems = Array.isArray(items) ? items : [];
  var result = [];
  var index = 0;

  for (index = 0; index < sourceItems.length; index += 1) {
    var source = sourceItems[index] || {};
    var id = Number(source.id || 0);
    var status = source.status || 'pending';
    var isReviewing = reviewingId === id;

    var approveText = '通过';
    if (isReviewing) {
      approveText = '处理中...';
    }

    result.push({
      id: id,
      nickName: source.nickName || '未命名用户',
      statusClass: status,
      statusText: source.statusText || '待审核',
      wechatIdText: '微信号：' + (source.wechatId || '未填写'),
      createdAtText: '提交时间：' + (source.createdAt || ''),
      reasonText: '申请说明：' + (source.reason || '未填写说明'),
      reviewNoteText: source.reviewNote ? ('审核说明：' + source.reviewNote) : '',
      showReviewNote: !!source.reviewNote,
      showActions: status === 'pending',
      rejectDisabled: isReviewing,
      approveDisabled: isReviewing,
      approveText: approveText
    });
  }

  return result;
}

function buildInvitations(items) {
  var sourceItems = Array.isArray(items) ? items : [];
  var result = [];
  var index = 0;

  for (index = 0; index < sourceItems.length; index += 1) {
    var source = sourceItems[index] || {};
    var status = source.status || 'pending';

    result.push({
      id: Number(source.id || 0),
      targetWechatId: source.targetWechatId || '未填写',
      statusClass: status,
      statusText: source.statusText || '待认领',
      invitationType: source.invitationType || 'wechat_id',
      invitationTypeText: (source.invitationType || 'wechat_id') === 'share_link' ? '授权方式：分享链接' : '授权方式：微信号授权',
      createdAtText: '创建时间：' + (source.createdAt || ''),
      createdByText: source.createdByName ? ('创建人：' + source.createdByName) : '',
      showCreatedBy: !!source.createdByName,
      noteText: '备注：' + (source.note || '无'),
      claimedUserText: source.claimedUserName ? ('已生效账号：' + source.claimedUserName) : '',
      showClaimedUser: !!source.claimedUserName,
      processedAtText: source.processedAt ? ('生效时间：' + source.processedAt) : '',
      showProcessedAt: !!source.processedAt
    });
  }

  return result;
}

function upsertInvitationSource(sourceItems, invitation) {
  var items = Array.isArray(sourceItems) ? sourceItems.slice() : [];
  var nextItems = [];
  var index = 0;
  var currentItem = null;
  var invitationId = Number((invitation || {}).id || 0);

  if (!invitationId) {
    return items;
  }

  nextItems.push(invitation);
  for (index = 0; index < items.length; index += 1) {
    currentItem = items[index] || {};
    if (Number(currentItem.id || 0) !== invitationId) {
      nextItems.push(currentItem);
    }
  }

  return nextItems;
}

function buildTabMeta(currentTab) {
  if (currentTab === 'invitations') {
    return {
      title: '管理员邀请',
      subtitle: '这里会显示所有邀请及其生效状态。',
      showApplications: false,
      showInvitations: true
    };
  }

  return {
    title: '管理员申请',
    subtitle: '优先处理待审核申请。',
    showApplications: true,
    showInvitations: false
  };
}

function buildTabs(currentTab, applicationCount, invitationCount) {
  var applicationClassName = 'tab-pill';
  var invitationClassName = 'tab-pill';

  if (currentTab === 'applications') {
    applicationClassName = 'tab-pill active';
  }

  if (currentTab === 'invitations') {
    invitationClassName = 'tab-pill active';
  }

  return [
    {
      key: 'applications',
      label: '申请列表 · ' + applicationCount,
      className: applicationClassName
    },
    {
      key: 'invitations',
      label: '邀请列表 · ' + invitationCount,
      className: invitationClassName
    }
  ];
}

function mergeHeaders(baseHeaders, extraHeaders) {
  var result = {};
  var key = '';

  baseHeaders = baseHeaders || {};
  extraHeaders = extraHeaders || {};

  for (key in baseHeaders) {
    if (Object.prototype.hasOwnProperty.call(baseHeaders, key)) {
      result[key] = baseHeaders[key];
    }
  }

  for (key in extraHeaders) {
    if (Object.prototype.hasOwnProperty.call(extraHeaders, key)) {
      result[key] = extraHeaders[key];
    }
  }

  return result;
}

Page({
  data: {
    loading: true,
    creatingInvitation: false,
    creatingShareInvitation: false,
    reviewingId: 0,
    currentTab: 'applications',
    currentTabTitle: '管理员申请',
    currentTabSubtitle: '优先处理待审核申请。',
    showApplications: true,
    showInvitations: false,
    hasApplications: false,
    hasInvitations: false,
    tabs: buildTabs('applications', 0, 0),
    userInfo: {},
    noPermission: false,
    canCreateShareInvitation: false,
    applications: [],
    invitations: [],
    createButtonText: '创建管理员邀请',
    shareButtonText: '准备管理员分享链接中...',
    refreshShareButtonText: '重新生成分享链接',
    shareInvitationToken: '',
    inviteForm: {
      targetWechatId: '',
      note: ''
    }
  },

  onLoad: function () {
    this.applicationSource = [];
    this.invitationSource = [];
    if (wx.showShareMenu) {
      wx.showShareMenu({
        menus: ['shareAppMessage']
      });
    }

    if (typeof app.requireLogin === 'function' && !app.requireLogin({ showToast: false })) {
      return;
    }

    this.loadData();
  },

  onShow: function () {
    if (typeof app.requireLogin === 'function' && !app.requireLogin({ showToast: false })) {
      return;
    }

    this.loadData();
  },

  refreshUserInfo: function () {
    var userInfo = normalizeUserInfo(app.globalData.userInfo);
    var noPermission = !canManageAdminPage(userInfo);

    this.syncViewData({
      userInfo: userInfo,
      noPermission: noPermission,
      canCreateShareInvitation: userInfo.adminLevel === 'super_admin'
    });

    return userInfo;
  },

  syncViewData: function (extraState) {
    var currentTab = '';
    var reviewingId = 0;
    var creatingInvitation = false;
    var creatingShareInvitation = false;
    var shareInvitationToken = '';
    var tabMeta = null;
    var applications = [];
    var invitations = [];
    var nextState = {};
    var key = '';

    extraState = extraState || {};

    currentTab = extraState.currentTab || this.data.currentTab || 'applications';
    reviewingId = Object.prototype.hasOwnProperty.call(extraState, 'reviewingId')
      ? extraState.reviewingId
      : (this.data.reviewingId || 0);
    creatingInvitation = Object.prototype.hasOwnProperty.call(extraState, 'creatingInvitation')
      ? extraState.creatingInvitation
      : !!this.data.creatingInvitation;
    creatingShareInvitation = Object.prototype.hasOwnProperty.call(extraState, 'creatingShareInvitation')
      ? extraState.creatingShareInvitation
      : !!this.data.creatingShareInvitation;
    shareInvitationToken = Object.prototype.hasOwnProperty.call(extraState, 'shareInvitationToken')
      ? extraState.shareInvitationToken
      : (this.data.shareInvitationToken || '');

    tabMeta = buildTabMeta(currentTab);
    applications = buildApplications(this.applicationSource, reviewingId);
    invitations = buildInvitations(this.invitationSource);

    nextState.currentTab = currentTab;
    nextState.currentTabTitle = tabMeta.title;
    nextState.currentTabSubtitle = tabMeta.subtitle;
    nextState.showApplications = tabMeta.showApplications;
    nextState.showInvitations = tabMeta.showInvitations;
    nextState.tabs = buildTabs(currentTab, applications.length, invitations.length);
    nextState.applications = applications;
    nextState.invitations = invitations;
    nextState.hasApplications = applications.length > 0;
    nextState.hasInvitations = invitations.length > 0;
    nextState.createButtonText = '创建管理员邀请';
    if (creatingInvitation) {
      nextState.createButtonText = '创建中...';
    }
    nextState.shareButtonText = shareInvitationToken ? '分享管理员链接' : '准备管理员分享链接中...';
    nextState.refreshShareButtonText = creatingShareInvitation ? '重新生成中...' : '重新生成分享链接';
    nextState.creatingInvitation = creatingInvitation;
    nextState.creatingShareInvitation = creatingShareInvitation;
    nextState.reviewingId = reviewingId;

    for (key in extraState) {
      if (Object.prototype.hasOwnProperty.call(extraState, key)) {
        nextState[key] = extraState[key];
      }
    }

    this.setData(nextState);
  },

  request: function (options, onSuccess, onFail) {
    var fallbackToken = wx.getStorageSync('token');
    var authHeader = {};
    var requestOptions = options || {};

    if (typeof app.getAuthHeader === 'function') {
      authHeader = app.getAuthHeader() || {};
    } else if (fallbackToken) {
      authHeader = {
        Authorization: fallbackToken
      };
    }

    wx.request({
      url: requestOptions.url,
      method: requestOptions.method || 'GET',
      data: requestOptions.data,
      header: mergeHeaders(authHeader, requestOptions.header),
      success: function (response) {
        if (typeof onSuccess === 'function') {
          onSuccess(response);
        }
      },
      fail: function (error) {
        if (typeof onFail === 'function') {
          onFail(error);
        }
      }
    });
  },

  handleUnauthorized: function (message) {
    this.applicationSource = [];
    this.invitationSource = [];

    if (typeof app.clearLoginState === 'function') {
      app.clearLoginState();
    }

    this.syncViewData({
      loading: false,
      noPermission: true,
      currentTab: 'applications'
    });

    wx.showToast({
      title: message || '登录已失效，请重新进入',
      icon: 'none'
    });
  },

  loadData: function () {
    var self = this;
    var userInfo = this.refreshUserInfo();

    if (!canManageAdminPage(userInfo)) {
      this.applicationSource = [];
      this.invitationSource = [];
      this.syncViewData({ loading: false });
      return;
    }

    this.syncViewData({ loading: true });

    this.request(
      {
        url: app.globalData.baseUrl + '/admin/applications',
        method: 'GET'
      },
      function (applicationsRes) {
        var applicationData = applicationsRes.data || {};

        if (applicationsRes.statusCode === 401) {
          self.handleUnauthorized();
          return;
        }

        if (applicationsRes.statusCode !== 200) {
          self.syncViewData({ loading: false });
          wx.showToast({
            title: applicationData.error || '申请列表加载失败',
            icon: 'none'
          });
          return;
        }

        self.request(
          {
            url: app.globalData.baseUrl + '/admin/invitations',
            method: 'GET'
          },
          function (invitationsRes) {
            var invitationData = invitationsRes.data || {};

            if (invitationsRes.statusCode === 401) {
              self.handleUnauthorized();
              return;
            }

            if (invitationsRes.statusCode !== 200) {
              self.syncViewData({ loading: false });
              wx.showToast({
                title: invitationData.error || '邀请列表加载失败',
                icon: 'none'
              });
              return;
            }

            self.applicationSource = Array.isArray(applicationData.items) ? applicationData.items : [];
            self.invitationSource = Array.isArray(invitationData.items) ? invitationData.items : [];
            self.syncViewData({ loading: false });
            if (self.data.canCreateShareInvitation) {
              self.ensureShareInvitationReady(false, true);
            }
          },
          function () {
            self.syncViewData({ loading: false });
            wx.showToast({
              title: '管理数据加载失败',
              icon: 'none'
            });
          }
        );
      },
      function () {
        self.syncViewData({ loading: false });
        wx.showToast({
          title: '管理数据加载失败',
          icon: 'none'
        });
      }
    );
  },

  switchTab: function (e) {
    var currentTab = e.currentTarget.dataset.tab;

    if (!currentTab || currentTab === this.data.currentTab) {
      return;
    }

    this.syncViewData({ currentTab: currentTab });
  },

  onInviteWechatIdInput: function (e) {
    this.setData({
      'inviteForm.targetWechatId': e.detail.value
    });
  },

  onInviteNoteInput: function (e) {
    this.setData({
      'inviteForm.note': e.detail.value
    });
  },

  ensureShareInvitationReady: function (forceRefresh, silent) {
    var self = this;
    var note = (this.data.inviteForm.note || '').trim();

    if (!this.data.canCreateShareInvitation || this.data.creatingShareInvitation || this.data.noPermission) {
      return;
    }

    if (!silent || forceRefresh) {
      this.setData({
        shareInvitationToken: ''
      });
    }
    this.syncViewData({
      creatingShareInvitation: true,
      shareInvitationToken: (!silent || forceRefresh) ? '' : this.data.shareInvitationToken
    });

    this.request(
      {
        url: app.globalData.baseUrl + '/admin/invitations',
        method: 'POST',
        data: {
          invitationType: 'share_link',
          note: note,
          forceRefresh: !!forceRefresh
        }
      },
      function (response) {
        var responseData = response.data || {};
        var invitation = responseData.invitation || {};
        var shareToken = responseData.shareToken || '';

        if (response.statusCode === 401) {
          self.syncViewData({ creatingShareInvitation: false });
          self.handleUnauthorized();
          return;
        }

        if (response.statusCode !== 200 || !responseData.success || !shareToken) {
          self.syncViewData({ creatingShareInvitation: false });
          if (!silent) {
            wx.showToast({
              title: responseData.error || '分享链接生成失败',
              icon: 'none'
            });
          }
          return;
        }

        if (invitation && invitation.id) {
          self.invitationSource = upsertInvitationSource(self.invitationSource, invitation);
        }
        self.setData({
          shareInvitationToken: shareToken
        });
        self.syncViewData({
          creatingShareInvitation: false,
          currentTab: silent ? self.data.currentTab : 'invitations',
          shareInvitationToken: shareToken
        });
        if (!silent) {
          wx.showToast({
            title: '分享链接已准备好',
            icon: 'success'
          });
        }
      },
      function () {
        self.syncViewData({ creatingShareInvitation: false });
        if (!silent) {
          wx.showToast({
            title: '分享链接生成失败',
            icon: 'none'
          });
        }
      }
    );
  },

  createShareInvitation: function () {
    this.ensureShareInvitationReady(true, false);
  },

  createInvitation: function () {
    var self = this;
    var targetWechatId = '';
    var note = '';

    if (this.data.creatingInvitation || this.data.noPermission) {
      return;
    }

    targetWechatId = (this.data.inviteForm.targetWechatId || '').trim();
    note = (this.data.inviteForm.note || '').trim();

    if (!targetWechatId) {
      wx.showToast({
        title: '请填写目标微信号',
        icon: 'none'
      });
      return;
    }

    this.syncViewData({ creatingInvitation: true });

    this.request(
      {
        url: app.globalData.baseUrl + '/admin/invitations',
        method: 'POST',
        data: {
          targetWechatId: targetWechatId,
          note: note
        }
      },
      function (response) {
        var responseData = response.data || {};

        if (response.statusCode === 401) {
          self.syncViewData({ creatingInvitation: false });
          self.handleUnauthorized();
          return;
        }

        if (response.statusCode !== 200 || !responseData.success) {
          self.syncViewData({ creatingInvitation: false });
          wx.showToast({
            title: responseData.error || '邀请失败',
            icon: 'none'
          });
          return;
        }

        self.setData({
          inviteForm: {
            targetWechatId: '',
            note: ''
          }
        });
        self.syncViewData({
          creatingInvitation: false,
          currentTab: 'invitations'
        });
        wx.showToast({
          title: '邀请已创建',
          icon: 'success'
        });
        self.loadData();
      },
      function () {
        self.syncViewData({ creatingInvitation: false });
        wx.showToast({
          title: '邀请失败',
          icon: 'none'
        });
      }
    );
  },

  reviewApplication: function (e) {
    var self = this;
    var applicationId = Number(e.currentTarget.dataset.id || 0);
    var action = e.currentTarget.dataset.action;
    var actionText = action === 'approve' ? '通过' : '拒绝';

    if (this.data.reviewingId || this.data.noPermission) {
      return;
    }

    if (!applicationId || (action !== 'approve' && action !== 'reject')) {
      return;
    }

    wx.showModal({
      title: '审核管理员申请',
      content: '确认' + actionText + '这条管理员申请吗？',
      success: function (modalRes) {
        if (!modalRes.confirm) {
          return;
        }

        self.syncViewData({ reviewingId: applicationId });

        self.request(
          {
            url: app.globalData.baseUrl + '/admin/applications/' + applicationId + '/review',
            method: 'POST',
            data: {
              action: action
            }
          },
          function (response) {
            var responseData = response.data || {};

            if (response.statusCode === 401) {
              self.syncViewData({ reviewingId: 0 });
              self.handleUnauthorized();
              return;
            }

            if (response.statusCode !== 200 || !responseData.success) {
              self.syncViewData({ reviewingId: 0 });
              wx.showToast({
                title: responseData.error || '审核失败',
                icon: 'none'
              });
              return;
            }

            self.syncViewData({ reviewingId: 0 });
            wx.showToast({
              title: '已' + actionText,
              icon: 'success'
            });
            self.loadData();
          },
          function () {
            self.syncViewData({ reviewingId: 0 });
            wx.showToast({
              title: '审核失败',
              icon: 'none'
            });
          }
        );
      }
    });
  },

  onShareAppMessage: function () {
    var shareToken = (this.data.shareInvitationToken || '').trim();
    var path = '/pages/welcome/index';

    if (shareToken) {
      path += '?adminInviteToken=' + encodeURIComponent(shareToken);
    }

    return {
      title: '管理员邀请你加入智心树洞管理台',
      path: path
    };
  }
});
