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

        const teachers = res.data.map((teacher) => ({
          id: teacher.id,
          name: teacher.nickName,
          avatar: teacher.avatarUrl || '',
          avatarText: (teacher.nickName || '教').slice(0, 1),
          desc: teacher.desc || '已认证教师'
        }));

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

  selectCounselor: function(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/post/create?counselorId=${id}&counselorName=${name}`
    });
  }
})
