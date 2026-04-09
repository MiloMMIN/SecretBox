// pages/post/select_counselor.js
const app = getApp();

const STAR_TREE_HOLE = {
  id: 0,
  name: '星空树洞',
  avatar: '',
  avatarText: '树',
  desc: '这里没有身份，只有倾听。把秘密告诉星空吧。全体教师均可查看并接力回复。',
  isTreeHole: true
};

function normalizeCounselor(teacher) {
  const profile = typeof app.normalizeTeacherProfile === 'function'
    ? app.normalizeTeacherProfile(teacher)
    : (teacher || {});
  const name = profile.nickName || teacher?.nickName || teacher?.nickname || teacher?.display_name || '未命名教师';

  return {
    id: profile.id ?? teacher?.id ?? null,
    name,
    avatar: profile.avatarUrl || teacher?.avatarUrl || teacher?.avatar_url || '',
    avatarText: name.slice(0, 1) || '教',
    desc: profile.desc || teacher?.desc || teacher?.description || '已认证教师'
  };
}

Page({
  data: {
    counselors: []
  },

  onLoad: function (options) {
    this.loadCounselors();
  },

  onShow() {
    this.loadCounselors();
  },

  loadCounselors() {
    this.setData({
      counselors: [STAR_TREE_HOLE]
    });

    wx.request({
      url: `${app.globalData.baseUrl}/teachers`,
      method: 'GET',
      success: (res) => {
        if (res.statusCode !== 200 || !Array.isArray(res.data)) {
          wx.showToast({
            title: res.data?.error || '教师数据加载失败',
            icon: 'none'
          });
          this.setData({ counselors: [STAR_TREE_HOLE] });
          return;
        }

        const teachers = res.data.map((teacher) => normalizeCounselor(teacher));

        this.setData({
          counselors: [
            STAR_TREE_HOLE,
            ...teachers
          ]
        });
      },
      fail: () => {
        wx.showToast({
          title: '教师列表加载失败',
          icon: 'none'
        });
        this.setData({
          counselors: [STAR_TREE_HOLE]
        });
      }
    });
  },

  onImageError(e) {
    const { index } = e.currentTarget.dataset;
    const counselors = this.data.counselors;
    if (counselors[index]) {
      counselors[index].avatarError = true;
      this.setData({ counselors });
    }
  },

  goHome: function() {
    wx.navigateTo({
      url: '/pages/welcome/index'
    });
  },

  selectCounselor: function(e) {
    const { id, name, avatar, avatarText } = e.currentTarget.dataset;
    const index = this.data.counselors.findIndex(c => c.id === id);
    const finalAvatar = (index !== -1 && this.data.counselors[index].avatarError) ? '' : (avatar || '');
    
    wx.navigateTo({
      url: `/pages/post/create?counselorId=${id}&counselorName=${encodeURIComponent(name || '')}&counselorAvatar=${encodeURIComponent(finalAvatar)}&counselorAvatarText=${encodeURIComponent(avatarText || '')}`
    });
  }
})
