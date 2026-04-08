const app = getApp();

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const TIME_SLOTS = [
  { start: '08:00', end: '08:30' },
  { start: '08:30', end: '09:00' },
  { start: '09:00', end: '09:30' },
  { start: '09:30', end: '10:00' },
  { start: '10:00', end: '10:30' },
  { start: '10:30', end: '11:00' },
  { start: '14:00', end: '14:30' },
  { start: '14:30', end: '15:00' },
  { start: '15:00', end: '15:30' },
  { start: '15:30', end: '16:00' }
];

function padNumber(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function formatDate(date) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function formatMonthKey(date) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}`;
}

function parseMonthKey(monthKey) {
  const [year, month] = (monthKey || '').split('-').map((item) => Number(item));
  return new Date(year, (month || 1) - 1, 1);
}

function formatMonthLabel(monthKey) {
  const [year, month] = (monthKey || '').split('-');
  return `${year} 年 ${month} 月`;
}

function getMonthKeyFromDate(dateString) {
  return (dateString || '').slice(0, 7);
}

function toMinutes(timeValue) {
  const [hours, minutes] = (timeValue || '').split(':').map((item) => Number(item));
  return (hours || 0) * 60 + (minutes || 0);
}

function hasUpcomingSlotsToday(currentMinutes) {
  return TIME_SLOTS.some((slot) => toMinutes(slot.start) > currentMinutes);
}

function getInitialViewDate(now = new Date()) {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  if (hasUpcomingSlotsToday(currentMinutes)) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

function formatSelectedDateLabel(dateString) {
  if (!dateString) {
    return '';
  }

  const [year, month, day] = dateString.split('-').map((item) => Number(item));
  const date = new Date(year, month - 1, day);
  const weekMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${year}年${month}月${day}日 ${weekMap[date.getDay()]}`;
}

function buildSlotDisplayText(selectedDateLabel, selectedSlotLabel) {
  if (!selectedDateLabel) {
    return '';
  }

  if (selectedSlotLabel) {
    return `${selectedDateLabel} ${selectedSlotLabel}`;
  }

  return `已选日期：${selectedDateLabel}`;
}

function normalizeTeacher(teacher) {
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

function groupAppointments(appointments) {
  return (appointments || []).reduce((result, item) => {
    const dateKey = item.date;
    if (!dateKey) {
      return result;
    }

    if (!result[dateKey]) {
      result[dateKey] = [];
    }

    result[dateKey].push(item);
    return result;
  }, {});
}

function sortAppointments(dayAppointments) {
  return [...(dayAppointments || [])].sort((left, right) => {
    return toMinutes(left.slotStart) - toMinutes(right.slotStart);
  });
}

function buildCountMap(appointmentsByDate) {
  return Object.keys(appointmentsByDate || {}).reduce((result, key) => {
    result[key] = (appointmentsByDate[key] || []).length;
    return result;
  }, {});
}

function buildCalendarDays(monthKey, selectedDate, today, countMap) {
  const monthDate = parseMonthKey(monthKey);
  const month = monthDate.getMonth();
  const firstDay = new Date(monthDate.getFullYear(), month, 1);
  const lastDay = new Date(monthDate.getFullYear(), month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;
  const cells = [];

  for (let index = 0; index < totalCells; index += 1) {
    const cellDate = new Date(monthDate.getFullYear(), month, index - startOffset + 1);
    const dateKey = formatDate(cellDate);
    cells.push({
      dateKey,
      day: cellDate.getDate(),
      isCurrentMonth: cellDate.getMonth() === month,
      isSelected: dateKey === selectedDate,
      isToday: dateKey === today,
      isPast: dateKey < today,
      count: countMap[dateKey] || 0
    });
  }

  return cells;
}

function buildTimeSlots(dayAppointments, selectedSlot, today, selectedDate, currentMinutes) {
  const appointmentMap = {};
  sortAppointments(dayAppointments).forEach((item) => {
    appointmentMap[item.slotStart] = item;
  });

  return TIME_SLOTS.map((slot) => {
    const occupied = appointmentMap[slot.start];
    const expired = selectedDate < today || (selectedDate === today && toMinutes(slot.start) <= currentMinutes);
    return {
      ...slot,
      occupied: !!occupied,
      expired,
      selected: !occupied && !expired && selectedSlot === slot.start,
      teacherName: occupied?.teacherName || ''
    };
  });
}

Page({
  data: {
    loading: true,
    scheduleLoading: false,
    teachers: [],
    weekLabels: WEEK_LABELS,
    today: '',
    currentMonth: '',
    monthLabel: '',
    selectedDate: '',
    selectedDateLabel: '',
    monthDays: [],
    appointmentsByDate: {},
    selectedDayAppointments: [],
    timeSlots: buildTimeSlots([], '', '', '', 0),
    selectedSlotLabel: '',
    slotDisplayText: '',
    currentMinutes: 0,
    submitting: false,
    form: {
      studentName: '',
      studentClass: '',
      teacherId: null,
      teacherName: '',
      slotStart: ''
    }
  },

  refreshNowState() {
    const now = new Date();
    this.setData({
      today: formatDate(now),
      currentMinutes: now.getHours() * 60 + now.getMinutes()
    });
  },

  onLoad() {
    const now = new Date();
    const today = formatDate(now);
    const initialDate = getInitialViewDate(now);
    const initialDateKey = formatDate(initialDate);
    const currentMonth = formatMonthKey(initialDate);

    this.setData({
      today,
      currentMonth,
      monthLabel: formatMonthLabel(currentMonth),
      selectedDate: initialDateKey,
      selectedDateLabel: formatSelectedDateLabel(initialDateKey),
      slotDisplayText: buildSlotDisplayText(formatSelectedDateLabel(initialDateKey), ''),
      monthDays: buildCalendarDays(currentMonth, initialDateKey, today, {}),
      timeSlots: buildTimeSlots([], '', today, initialDateKey, now.getHours() * 60 + now.getMinutes()),
      currentMinutes: now.getHours() * 60 + now.getMinutes()
    });

    this.loadTeachers();
    this.loadMonthData(currentMonth, initialDateKey);
  },

  onShow() {
    this.refreshNowState();
    if (this.data.currentMonth) {
      this.loadMonthData(this.data.currentMonth, this.data.selectedDate, true);
    }
  },

  loadTeachers() {
    wx.request({
      url: `${app.globalData.baseUrl}/teachers`,
      method: 'GET',
      success: (res) => {
        if (res.statusCode !== 200 || !Array.isArray(res.data)) {
          wx.showToast({
            title: res.data?.error || '教师列表加载失败',
            icon: 'none'
          });
          return;
        }

        this.setData({
          teachers: res.data.map((item) => normalizeTeacher(item))
        });
      },
      fail: () => {
        wx.showToast({
          title: '教师列表加载失败',
          icon: 'none'
        });
      }
    });
  },

  loadMonthData(monthKey, targetDate, silent = false) {
    if (!silent) {
      this.setData({ scheduleLoading: true });
    }

    wx.request({
      url: `${app.globalData.baseUrl}/appointments/calendar`,
      method: 'GET',
      data: {
        month: monthKey
      },
      success: (res) => {
        this.setData({ scheduleLoading: false, loading: false });
        if (res.statusCode !== 200) {
          wx.showToast({
            title: res.data?.error || '预约日历加载失败',
            icon: 'none'
          });
          return;
        }

        const appointments = Array.isArray(res.data?.appointments) ? res.data.appointments : [];
        const appointmentsByDate = groupAppointments(appointments);
        const safeSelectedDate = getMonthKeyFromDate(targetDate) === monthKey
          ? targetDate
          : `${monthKey}-01`;
        const selectedDayAppointments = sortAppointments(appointmentsByDate[safeSelectedDate] || []);

        this.setData({
          currentMonth: monthKey,
          monthLabel: res.data?.monthLabel || formatMonthLabel(monthKey),
          appointmentsByDate,
          selectedDate: safeSelectedDate,
          selectedDateLabel: formatSelectedDateLabel(safeSelectedDate),
          selectedDayAppointments,
          selectedSlotLabel: '',
          slotDisplayText: buildSlotDisplayText(formatSelectedDateLabel(safeSelectedDate), ''),
          'form.slotStart': '',
          monthDays: buildCalendarDays(monthKey, safeSelectedDate, this.data.today, buildCountMap(appointmentsByDate)),
          timeSlots: buildTimeSlots(
            selectedDayAppointments,
            '',
            this.data.today,
            safeSelectedDate,
            this.data.currentMinutes
          )
        });
      },
      fail: () => {
        this.setData({ scheduleLoading: false, loading: false });
        wx.showToast({
          title: '预约日历加载失败',
          icon: 'none'
        });
      }
    });
  },

  changeMonth(e) {
    const step = Number(e.currentTarget.dataset.step || 0);
    const baseDate = parseMonthKey(this.data.currentMonth);
    const nextMonthDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + step, 1);
    const nextMonth = formatMonthKey(nextMonthDate);
    const selectedDate = nextMonth === getMonthKeyFromDate(this.data.today)
      ? this.data.today
      : `${nextMonth}-01`;

    this.setData({
      currentMonth: nextMonth,
      monthLabel: formatMonthLabel(nextMonth),
      selectedDate,
      selectedDateLabel: formatSelectedDateLabel(selectedDate),
      slotDisplayText: buildSlotDisplayText(formatSelectedDateLabel(selectedDate), ''),
      monthDays: buildCalendarDays(nextMonth, selectedDate, this.data.today, {}),
      selectedDayAppointments: [],
      selectedSlotLabel: '',
      'form.slotStart': ''
    });
    this.loadMonthData(nextMonth, selectedDate);
  },

  pickDate(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) {
      return;
    }

    const targetMonth = getMonthKeyFromDate(date);
    if (targetMonth !== this.data.currentMonth) {
      this.setData({
        'form.slotStart': ''
      });
      this.loadMonthData(targetMonth, date);
      return;
    }

    const selectedDayAppointments = sortAppointments(this.data.appointmentsByDate[date] || []);
    this.setData({
      selectedDate: date,
      selectedDateLabel: formatSelectedDateLabel(date),
      selectedDayAppointments,
      selectedSlotLabel: '',
      slotDisplayText: buildSlotDisplayText(formatSelectedDateLabel(date), ''),
      'form.slotStart': '',
      monthDays: buildCalendarDays(this.data.currentMonth, date, this.data.today, buildCountMap(this.data.appointmentsByDate)),
      timeSlots: buildTimeSlots(
        selectedDayAppointments,
        '',
        this.data.today,
        date,
        this.data.currentMinutes
      )
    });
  },

  onTeacherImageError(e) {
    const teacherId = e.currentTarget.dataset.id;
    const teachers = this.data.teachers.map((item) => {
      if (item.id === teacherId) {
        return {
          ...item,
          avatarError: true
        };
      }
      return item;
    });

    this.setData({ teachers });
  },

  selectTeacher(e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({
      'form.teacherId': Number(id),
      'form.teacherName': name || ''
    });
  },

  onStudentNameInput(e) {
    this.setData({
      'form.studentName': e.detail.value
    });
  },

  onStudentClassInput(e) {
    this.setData({
      'form.studentClass': e.detail.value
    });
  },

  selectSlot(e) {
    const start = e.currentTarget.dataset.start;
    const slot = this.data.timeSlots.find((item) => item.start === start);

    if (!slot || slot.occupied || slot.expired) {
      return;
    }

    this.setData({
      'form.slotStart': start,
      selectedSlotLabel: `${slot.start} - ${slot.end}`,
      slotDisplayText: buildSlotDisplayText(this.data.selectedDateLabel, `${slot.start} - ${slot.end}`),
      timeSlots: buildTimeSlots(
        this.data.selectedDayAppointments,
        start,
        this.data.today,
        this.data.selectedDate,
        this.data.currentMinutes
      )
    });
  },

  submitAppointment() {
    const studentName = (this.data.form.studentName || '').trim();
    const studentClass = (this.data.form.studentClass || '').trim();
    const teacherId = this.data.form.teacherId;
    const slotStart = this.data.form.slotStart;

    if (!studentName) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }

    if (!studentClass) {
      wx.showToast({ title: '请输入班级', icon: 'none' });
      return;
    }

    if (!teacherId) {
      wx.showToast({ title: '请选择老师', icon: 'none' });
      return;
    }

    if (!this.data.selectedDate) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return;
    }

    if (!slotStart) {
      wx.showToast({ title: '请选择时间', icon: 'none' });
      return;
    }

    const targetSlot = this.data.timeSlots.find((item) => item.start === slotStart);
    if (!targetSlot || targetSlot.occupied || targetSlot.expired) {
      wx.showToast({ title: '该时段不可预约', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '预约中...' });

    wx.request({
      url: `${app.globalData.baseUrl}/appointments`,
      method: 'POST',
      header: typeof app.getAuthHeader === 'function' ? app.getAuthHeader() : {},
      data: {
        studentName,
        studentClass,
        teacherId,
        date: this.data.selectedDate,
        slotStart
      },
      success: (res) => {
        wx.hideLoading();
        this.setData({ submitting: false });

        if (res.statusCode !== 201 || !res.data?.success) {
          wx.showToast({
            title: res.data?.error || '预约失败',
            icon: 'none'
          });
          if (res.statusCode === 409) {
            this.loadMonthData(this.data.currentMonth, this.data.selectedDate, true);
          }
          return;
        }

        wx.showToast({
          title: '预约成功',
          icon: 'success'
        });

        this.setData({
          'form.slotStart': '',
          selectedSlotLabel: '',
          slotDisplayText: buildSlotDisplayText(this.data.selectedDateLabel, '')
        });
        this.loadMonthData(this.data.currentMonth, this.data.selectedDate, true);

        if (res.data.notificationStatus && res.data.notificationStatus !== 'sent') {
          setTimeout(() => {
            wx.showModal({
              title: '预约已提交',
              content: res.data.notificationMessage || '预约已经成功，但钉钉通知需要管理员进一步配置。',
              showCancel: false
            });
          }, 450);
        }
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ submitting: false });
        wx.showToast({
          title: '预约失败',
          icon: 'none'
        });
      }
    });
  }
});
