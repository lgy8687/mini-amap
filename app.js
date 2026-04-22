/**
 * 极简地图 PWA - 基于高德 JS API 的精简版地图工具
 * 纯个人学习使用，无广告、无臃余功能
 */

(function () {
  'use strict';

  // ===== 注册 Service Worker =====
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // ===== 状态管理 =====
  const state = {
    map: null,
    key: localStorage.getItem('amap_key') || '',
    securityCode: localStorage.getItem('amap_security') || '',
    currentLocation: null,
    currentCity: null,
    locationMarker: null,
    searchMarkers: [],
    routeResult: null,
    startLngLat: null,
    endLngLat: null,
    routeMode: 'driving',
  };

  // ===== DOM 引用 =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    topBar: $('#top-bar'),
    searchInput: $('#search-input'),
    searchBtn: $('#search-btn'),
    searchPanel: $('#search-panel'),
    searchResults: $('#search-results'),
    closeSearch: $('#close-search'),
    routePanel: $('#route-panel'),
    routeStart: $('#route-start'),
    routeEnd: $('#route-end'),
    locateStart: $('#locate-start'),
    routeBtn: $('#route-btn'),
    routeResults: $('#route-results'),
    closeRoute: $('#close-route'),
    sidebar: $('#sidebar'),
    sidebarOverlay: $('#sidebar-overlay'),
    menuBtn: $('#menu-btn'),
    closeMenu: $('#close-menu'),
    menuSearch: $('#menu-search'),
    menuRoute: $('#menu-route'),
    menuLocate: $('#menu-locate'),
    menuKey: $('#menu-key'),
    locateBtn: $('#locate-btn'),
    routeFloatBtn: $('#route-float-btn'),
    keyModal: $('#key-modal'),
    keyInput: $('#key-input'),
    securityInput: $('#security-input'),
    saveKey: $('#save-key'),
    keyError: $('#key-error'),
    mapContainer: $('#map-container'),
  };

  // ===== 面板控制 =====
  function openSearchPanel() {
    dom.searchPanel.classList.remove('hidden');
    dom.searchInput.focus();
  }

  function closeSearchPanel() {
    dom.searchPanel.classList.add('hidden');
  }

  function openRoutePanel() {
    dom.routePanel.classList.remove('hidden');
    closeSidebar();
  }

  function closeRoutePanel() {
    dom.routePanel.classList.add('hidden');
  }

  function openSidebar() {
    dom.sidebar.classList.remove('hidden');
    dom.sidebarOverlay.classList.remove('hidden');
  }

  function closeSidebar() {
    if (window.innerWidth < 769) {
      dom.sidebar.classList.add('hidden');
      dom.sidebarOverlay.classList.add('hidden');
    }
  }

  function openKeyModal() {
    dom.keyModal.classList.remove('hidden');
    closeSidebar();
  }

  // ===== 高德 API 加载 =====
  function loadAMapAPI() {
    return new Promise((resolve, reject) => {
      if (window.AMap) {
        resolve();
        return;
      }

      if (!state.key) {
        dom.keyModal.classList.remove('hidden');
        reject(new Error('需要配置 Key'));
        return;
      }

      if (state.securityCode) {
        window._AMapSecurityConfig = {
          securityJsCode: state.securityCode,
        };
      }

      const script = document.createElement('script');
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${state.key}&plugin=AMap.Geolocation,AMap.PlaceSearch,AMap.Driving,AMap.Transit,AMap.Walking,AMap.Riding,AMap.AutoComplete,AMap.Geocoder`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('高德地图 JS API 加载失败，请检查 Key 是否正确'));
      document.head.appendChild(script);
    });
  }

  // ===== 地图初始化 =====
  function initMap() {
    state.map = new AMap.Map('map-container', {
      zoom: 13,
      center: [116.397428, 39.90923],
      mapStyle: 'amap://styles/normal',
      resizeEnable: true,
      zooms: [3, 20],
    });

    getCurrentLocation();

    state.map.on('click', (e) => {
      reverseGeocode(e.lnglat);
    });
  }

  // ===== 定位 =====
  function getCurrentLocation() {
    const geolocation = new AMap.Geolocation({
      enableHighAccuracy: true,
      timeout: 10000,
    });

    geolocation.getCurrentPosition((status, result) => {
      if (status === 'complete') {
        state.currentLocation = result.position;
        state.map.setCenter(result.position);

        if (state.locationMarker) {
          state.locationMarker.setPosition(result.position);
        } else {
          state.locationMarker = new AMap.Marker({
            position: result.position,
            icon: new AMap.Icon({
              size: new AMap.Size(28, 34),
              image: '//a.amap.com/jsapi_demos/static/demo-center/icons/poi-marker-default.png',
              imageSize: new AMap.Size(28, 34),
            }),
            title: '当前位置',
            zIndex: 200,
          });
          state.map.add(state.locationMarker);
        }
      }
    });
  }

  // ===== 逆地理编码 =====
  function reverseGeocode(lnglat) {
    const geocoder = new AMap.Geocoder();
    geocoder.getAddress(lnglat, (status, result) => {
      if (status === 'complete' && result.regeocode) {
        const addr = result.regeocode.formattedAddress;
        showInfoWindow(lnglat, addr, addr);
      }
    });
  }

  // ===== 信息窗口 =====
  function showInfoWindow(lnglat, title, address) {
    const template = $('#info-window-template');
    const content = template.innerHTML;

    const infoWindow = new AMap.InfoWindow({
      content: content
        .replace('class="info-title"></div>', `class="info-title">${title}</div>`)
        .replace('class="info-addr"></div>', `class="info-addr">${address || ''}</div>`),
      offset: new AMap.Pixel(0, -36),
    });

    infoWindow.open(state.map, lnglat);

    setTimeout(() => {
      const startBtn = document.querySelector('.btn-to-start');
      const endBtn = document.querySelector('.btn-to-end');
      if (startBtn) {
        startBtn.onclick = () => {
          state.startLngLat = lnglat;
          dom.routeStart.value = title;
          infoWindow.close();
          openRoutePanel();
        };
      }
      if (endBtn) {
        endBtn.onclick = () => {
          state.endLngLat = lnglat;
          dom.routeEnd.value = title;
          infoWindow.close();
          openRoutePanel();
        };
      }
    }, 150);
  }

  // 获取当前城市
  function getCurrentCity(callback) {
    if (state.currentCity) {
      callback(state.currentCity);
      return;
    }

    const geocoder = new AMap.Geocoder();
    const center = state.map ? state.map.getCenter() : [116.397428, 39.90923];

    geocoder.getAddress(center, (status, result) => {
      if (status === 'complete' && result.regeocode) {
        const city = result.regeocode.addressComponent.city ||
                    result.regeocode.addressComponent.province;
        state.currentCity = city;
        callback(city);
      } else {
        callback('全国');
      }
    });
  }

  // ===== 地点搜索 =====
  function searchPlace(keyword) {
    if (!keyword.trim()) return;

    // 先获取当前城市，然后优先搜索本地
    getCurrentCity((city) => {
      // 第一步：在当前城市搜索
      searchInCity(keyword, city, (localResults) => {
        if (localResults && localResults.length > 0) {
          // 本地有结果，直接显示
          renderAndShowResults(localResults);
        } else {
          // 本地没结果，全国搜索
          searchInCity(keyword, '全国', (nationalResults) => {
            if (nationalResults && nationalResults.length > 0) {
              renderAndShowResults(nationalResults);
            } else {
              dom.searchResults.innerHTML = '<div class="result-item"><div class="result-info"><div class="result-name">未找到相关地点</div></div></div>';
              openSearchPanel();
            }
          });
        }
      });
    });
  }

  function searchInCity(keyword, city, callback) {
    const autoComplete = new AMap.AutoComplete({
      city: city,
    });

    autoComplete.search(keyword, (status, result) => {
      if (status === 'complete' && result.tips && result.tips.length > 0) {
        const tips = result.tips.filter(tip => tip.location && tip.location.lng);
        callback(tips);
      } else {
        callback([]);
      }
    });
  }

  function renderAndShowResults(tips) {
    clearSearchMarkers();

    // 按距离排序（如果有当前位置）
    if (state.currentLocation) {
      tips.sort((a, b) => {
        const distA = state.currentLocation.distance([a.location.lng, a.location.lat]);
        const distB = state.currentLocation.distance([b.location.lng, b.location.lat]);
        return distA - distB;
      });
    }

    // 限制显示数量
    const displayTips = tips.slice(0, 10);

    dom.searchResults.innerHTML = displayTips
      .map((tip, i) => `
        <div class="result-item" data-index="${i}" data-lng="${tip.location.lng}" data-lat="${tip.location.lat}">
          <div class="result-index">${i + 1}</div>
          <div class="result-info">
            <div class="result-name">${tip.name}</div>
            <div class="result-addr">${tip.district || ''} ${tip.address || ''}</div>
          </div>
          <button class="btn-nav" data-lng="${tip.location.lng}" data-lat="${tip.location.lat}" data-name="${tip.name}">导航</button>
        </div>
      `)
      .join('');

    // 添加标记到地图
    displayTips.forEach((tip, index) => {
      if (tip.location && tip.location.lng) {
        const marker = new AMap.Marker({
          position: [tip.location.lng, tip.location.lat],
          title: tip.name,
          label: {
            content: `${index + 1}`,
            direction: 'top',
          },
        });

        marker.on('click', () => {
          showInfoWindow([tip.location.lng, tip.location.lat], tip.name, tip.district + ' ' + (tip.address || ''));
        });

        state.searchMarkers.push(marker);
      }
    });

    state.map.add(state.searchMarkers);

    if (state.searchMarkers.length > 0) {
      state.map.setFitView(state.searchMarkers, false, [60, 60, 60, 120]);
    }

    bindResultEvents();
    openSearchPanel();
  }

  function bindResultEvents() {
    // 点击结果项 - 定位到地图
    dom.searchResults.querySelectorAll('.result-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-nav')) return;
        const lng = parseFloat(item.dataset.lng);
        const lat = parseFloat(item.dataset.lat);
        const lnglat = new AMap.LngLat(lng, lat);
        const name = item.querySelector('.result-name').textContent;
        const addr = item.querySelector('.result-addr').textContent;

        state.map.setZoomAndCenter(16, lnglat);
        showInfoWindow(lnglat, name, addr);
        closeSearchPanel();
      });
    });

    // 点击导航按钮 - 直接规划路线
    dom.searchResults.querySelectorAll('.btn-nav').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lng = parseFloat(btn.dataset.lng);
        const lat = parseFloat(btn.dataset.lat);
        const name = btn.dataset.name;

        state.endLngLat = new AMap.LngLat(lng, lat);
        dom.routeEnd.value = name;

        if (state.currentLocation) {
          state.startLngLat = state.currentLocation;
          dom.routeStart.value = '当前位置';
        }

        closeSearchPanel();

        setTimeout(() => {
          quickPlanRoute();
        }, 100);
      });
    });
  }

  // 快速规划路线（不打开面板，直接在地图上显示）
  function quickPlanRoute() {
    if (!state.endLngLat) return;

    const startPos = state.currentLocation || state.startLngLat;
    if (!startPos) {
      getCurrentLocation();
      setTimeout(quickPlanRoute, 2000);
      return;
    }

    // 清除旧路线
    if (state.routeResult) {
      state.routeResult.clear();
    }

    const planner = new AMap.Driving({ map: state.map });
    planner.search(startPos, state.endLngLat, (status, result) => {
      if (status === 'complete' && result.routes && result.routes.length > 0) {
        // 显示路线成功，地图会自动调整视野
      }
    });

    state.routeResult = planner;
  }

  function clearSearchMarkers() {
    state.searchMarkers.forEach((m) => m.setMap(null));
    state.searchMarkers = [];
  }

  // ===== 路线规划 =====
  function planRoute() {
    const startVal = dom.routeStart.value.trim();
    const endVal = dom.routeEnd.value.trim();

    if (!endVal) {
      dom.routeEnd.focus();
      return;
    }

    const resolvePlace = (val, lngLatHint) => {
      return new Promise((resolve) => {
        if (lngLatHint) { resolve(lngLatHint); return; }
        if (!val && state.currentLocation) { resolve(state.currentLocation); return; }
        if (!val) { resolve(null); return; }

        const placeSearch = new AMap.PlaceSearch({ pageSize: 1 });
        placeSearch.search(val, (status, result) => {
          if (status === 'complete' && result.poiList && result.poiList.pois.length > 0) {
            resolve(result.poiList.pois[0].location);
          } else {
            resolve(null);
          }
        });
      });
    };

    Promise.all([
      resolvePlace(startVal, state.startLngLat),
      resolvePlace(endVal, state.endLngLat),
    ]).then(([startPos, endPos]) => {
      if (!startPos) {
        dom.routeResults.innerHTML = '<div class="result-item"><div class="result-info"><div class="result-name">无法解析起点，请输入更具体的地址</div></div></div>';
        return;
      }
      if (!endPos) {
        dom.routeResults.innerHTML = '<div class="result-item"><div class="result-info"><div class="result-name">无法解析终点，请输入更具体的地址</div></div></div>';
        return;
      }

      if (state.routeResult) {
        state.routeResult.clear();
      }

      const mode = state.routeMode;
      let planner;

      switch (mode) {
        case 'driving':
          planner = new AMap.Driving({ map: state.map });
          break;
        case 'transit':
          planner = new AMap.Transit({ map: state.map, city: '全国' });
          break;
        case 'walking':
          planner = new AMap.Walking({ map: state.map });
          break;
        case 'riding':
          planner = new AMap.Riding({ map: state.map });
          break;
      }

      planner.search(startPos, endPos, (status, result) => {
        handleRouteResult(status, result, mode);
      });

      state.routeResult = planner;
    });
  }

  function handleRouteResult(status, result, mode) {
    if (status !== 'complete') {
      dom.routeResults.innerHTML = '<div class="result-item"><div class="result-info"><div class="result-name">未找到路线</div></div></div>';
      return;
    }

    let html = '';

    if (mode === 'driving' && result.routes && result.routes.length > 0) {
      const route = result.routes[0];
      const distance = (route.distance / 1000).toFixed(1);
      const time = Math.ceil(route.time / 60);
      html += `
        <div class="route-summary">
          <div class="route-meta">
            <span>🛣 ${distance} 公里</span>
            <span>⏱ 约 ${time} 分钟</span>
          </div>
        </div>
      `;
      route.steps.forEach((step) => {
        html += `<div class="route-step">${step.instruction}</div>`;
      });
    } else if (mode === 'transit' && result.transits && result.transits.length > 0) {
      result.transits.slice(0, 3).forEach((transit) => {
        const distance = (transit.distance / 1000).toFixed(1);
        const time = Math.ceil(transit.time / 60);
        html += `
          <div class="route-summary">
            <div class="route-meta">
              <span>🛣 ${distance} 公里</span>
              <span>⏱ 约 ${time} 分钟</span>
            </div>
          </div>
        `;
        transit.segments.forEach((seg) => {
          if (seg.bus && seg.bus.buslines && seg.bus.buslines.length > 0) {
            const busline = seg.bus.buslines[0];
            html += `<div class="route-step">🚌 ${busline.name}（${busline.departure_stop.name} → ${busline.arrival_stop.name}）</div>`;
          } else if (seg.walking && seg.walking.steps) {
            seg.walking.steps.forEach((s) => {
              html += `<div class="route-step">🚶 ${s.instruction}</div>`;
            });
          }
        });
      });
    } else if (mode === 'walking' && result.routes && result.routes.length > 0) {
      const route = result.routes[0];
      const distance = (route.distance / 1000).toFixed(1);
      const time = Math.ceil(route.time / 60);
      html += `
        <div class="route-summary">
          <div class="route-meta">
            <span>🛣 ${distance} 公里</span>
            <span>⏱ 约 ${time} 分钟</span>
          </div>
        </div>
      `;
      route.steps.forEach((step) => {
        html += `<div class="route-step">🚶 ${step.instruction}</div>`;
      });
    } else if (mode === 'riding' && result.routes && result.routes.length > 0) {
      const route = result.routes[0];
      const distance = (route.distance / 1000).toFixed(1);
      const time = Math.ceil(route.time / 60);
      html += `
        <div class="route-summary">
          <div class="route-meta">
            <span>🛣 ${distance} 公里</span>
            <span>⏱ 约 ${time} 分钟</span>
          </div>
        </div>
      `;
      route.rides.forEach((ride) => {
        html += `<div class="route-step">🚴 ${ride.instruction}</div>`;
      });
    }

    dom.routeResults.innerHTML = html || '<div class="result-item"><div class="result-info"><div class="result-name">未找到路线</div></div></div>';
  }

  // ===== 事件绑定 =====
  function bindEvents() {
    // 搜索
    dom.searchBtn.addEventListener('click', () => {
      searchPlace(dom.searchInput.value);
    });

    dom.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchPlace(dom.searchInput.value);
    });

    dom.closeSearch.addEventListener('click', closeSearchPanel);

    // 路线
    dom.routeFloatBtn.addEventListener('click', openRoutePanel);
    dom.closeRoute.addEventListener('click', closeRoutePanel);
    dom.routeBtn.addEventListener('click', planRoute);
    dom.routeEnd.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') planRoute();
    });

    dom.locateStart.addEventListener('click', () => {
      if (state.currentLocation) {
        dom.routeStart.value = '当前位置';
        state.startLngLat = state.currentLocation;
      } else {
        getCurrentLocation();
        setTimeout(() => {
          if (state.currentLocation) {
            dom.routeStart.value = '当前位置';
            state.startLngLat = state.currentLocation;
          }
        }, 3000);
      }
    });

    $$('.route-mode').forEach((el) => {
      el.addEventListener('click', () => {
        $$('.route-mode').forEach((m) => m.classList.remove('active'));
        el.classList.add('active');
        state.routeMode = el.dataset.mode;
      });
    });

    // 菜单
    dom.menuBtn.addEventListener('click', openSidebar);
    dom.closeMenu.addEventListener('click', closeSidebar);
    dom.sidebarOverlay.addEventListener('click', closeSidebar);

    dom.menuSearch.addEventListener('click', () => {
      closeSidebar();
      dom.searchInput.focus();
    });

    dom.menuRoute.addEventListener('click', () => {
      closeSidebar();
      openRoutePanel();
    });

    dom.menuLocate.addEventListener('click', () => {
      closeSidebar();
      getCurrentLocation();
    });

    dom.menuKey.addEventListener('click', openKeyModal);

    // 定位
    dom.locateBtn.addEventListener('click', getCurrentLocation);

    // Key
    dom.saveKey.addEventListener('click', () => {
      const key = dom.keyInput.value.trim();
      const security = dom.securityInput.value.trim();

      if (!key) {
        dom.keyError.textContent = '请输入 Key';
        return;
      }

      state.key = key;
      state.securityCode = security;
      localStorage.setItem('amap_key', key);
      localStorage.setItem('amap_security', security);

      dom.keyModal.classList.add('hidden');
      dom.keyError.textContent = '';

      loadAMapAPI()
        .then(() => initMap())
        .catch((err) => {
          dom.keyError.textContent = err.message;
          dom.keyModal.classList.remove('hidden');
        });
    });

    dom.routeStart.addEventListener('input', () => {
      if (dom.routeStart.value !== '当前位置') state.startLngLat = null;
    });
    dom.routeEnd.addEventListener('input', () => {
      state.endLngLat = null;
    });

    // 返回键关闭面板（移动端习惯）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!dom.routePanel.classList.contains('hidden')) {
          closeRoutePanel();
        } else if (!dom.searchPanel.classList.contains('hidden')) {
          closeSearchPanel();
        } else if (!dom.keyModal.classList.contains('hidden')) {
          dom.keyModal.classList.add('hidden');
        }
      }
    });
  }

  // ===== 启动 =====
  function init() {
    // 移动端默认隐藏侧栏
    if (window.innerWidth < 769) {
      dom.sidebar.classList.add('hidden');
      dom.sidebarOverlay.classList.add('hidden');
    }

    bindEvents();

    if (state.key) {
      loadAMapAPI()
        .then(() => initMap())
        .catch((err) => {
          console.error('地图加载失败:', err);
          dom.keyError.textContent = err.message;
          dom.keyModal.classList.remove('hidden');
        });
    } else {
      dom.keyModal.classList.remove('hidden');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
