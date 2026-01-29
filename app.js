// app.js
App({
  onLaunch() {
    // 登录逻辑（模拟）
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)
  },
  globalData: {
    userInfo: {
      nickName: "匿名同学",
      avatarUrl: "https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0",
      role: "student" // 'student' or 'teacher'
    },
    baseUrl: "http://localhost:5000/api" // 模拟后端地址
  }
})
