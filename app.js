/**
 * 极简地图 PWA - 基于高德 JS API 的精简版地图工具
 * 纯个人学习使用，无广告、无臃余功能
 */

(function () {
  'use strict';

  // ===== 注册 Service Worker =====
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/mini-amap/sw.js').catch(() => {});
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
    routeResults: [], // 存储多条路线结果
    routeMarkers: [], // 路线起终点标记
    startLngLat: null,
    endLngLat: null,
    startPos: null,
    endPos: null,
    routeMode: 'driving',
    trafficLayer: null,
    trafficVisible: false,
  };

  // 路线颜色配置
  const ROUTE_COLORS = ['#1677ff', '#52c41a', '#faad14'];

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
    routeCards: $('#route-cards'),
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

    state.trafficLayer = new AMap.TileLayer.Traffic({
      autoRefresh: true,
      interval: 180,
    });

    getCurrentLocation();

    state.map.on('click', (e) => {
      reverseGeocode(e.lnglat);
    });
  }

  // ===== 实时路况切换 =====
  function toggleTraffic() {
    if (!state.map) return;
    if (state.trafficVisible) {
      state.map.remove(state.trafficLayer);
      state.trafficVisible = false;
    } else {
      state.map.add(state.trafficLayer);
      state.trafficVisible = true;
    }
    updateTrafficButton();
  }

  function updateTrafficButton() {
    const btn = document.getElementById('traffic-btn');
    if (btn) {
      if (state.trafficVisible) {
        btn.classList.add('active');
        btn.innerHTML = '🚦';
      } else {
        btn.classList.remove('active');
        btn.innerHTML = '🚥';
      }
    }
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

    getCurrentCity((city) => {
      searchInCity(keyword, city, (localResults) => {
        if (localResults && localResults.length > 0) {
          renderAndShowResults(localResults);
        } else {
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

    if (state.currentLocation) {
      tips.sort((a, b) => {
        const distA = state.currentLocation.distance([a.location.lng, a.location.lat]);
        const distB = state.currentLocation.distance([b.location.lng, b.location.lat]);
        return distA - distB;
      });
    }

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

    dom.searchResults.querySelectorAll('.btn-nav').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lng = parseFloat(btn.dataset.lng);
        const lat = parseFloat(btn.dataset.lat);
        const name = btn.dataset.name;

        // 清除搜索标记，只保留路线
        clearSearchMarkers();

        state.endLngLat = new AMap.LngLat(lng, lat);
        dom.routeEnd.value = name;

        if (state.currentLocation) {
          state.startLngLat = state.currentLocation;
          dom.routeStart.value = '当前位置';
        }

        closeSearchPanel();

        // 直接规划路线并显示在地图上
        setTimeout(() => {
          quickPlanRoute();
        }, 100);
      });
    });
  }

  // 快速规划路线（显示三条不同策略的路线）
  // 快速规划路线 - 直接复用驾车多路线规划
  function quickPlanRoute() {
    if (!state.endLngLat) return;

    const startPos = state.currentLocation || state.startLngLat;
    if (!startPos) {
      getCurrentLocation();
      setTimeout(quickPlanRoute, 2000);
      return;
    }

    // 直接调用已有的驾车多路线规划函数
    state.startPos = startPos;
    state.endPos = state.endLngLat;
    state.routeMode = 'driving';
    
    // 关闭搜索面板
    closeSearchPanel();
    
    // 调用多路线规划
    planDrivingRoutes(startPos, state.endLngLat);
  }

  // 显示路线信息（兼容旧代码）
  function showRouteInfo(lnglat, info) {
    // 不再使用弹窗，信息直接显示在卡片上
  }

  function clearSearchMarkers() {
    state.searchMarkers.forEach((m) => m.setMap(null));
    state.searchMarkers = [];
    clearRoutePolylines();
  }

  // ===== 路线规划（支持多路线） =====
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

      // 保存起终点
      state.startPos = startPos;
      state.endPos = endPos;

      clearRoutePolylines();

      const mode = state.routeMode;

      if (mode === 'driving') {
        planDrivingRoutes(startPos, endPos);
      } else {
        planSingleRoute(startPos, endPos, mode);
      }
    });
  }

  // ===== 驾车多路线规划 =====
  function planDrivingRoutes(startPos, endPos) {
    const policies = [
      { policy: AMap.DrivingPolicy.LEAST_TIME, name: '最快路线', icon: '🚀' },
      { policy: AMap.DrivingPolicy.LEAST_DISTANCE, name: '最短路线', icon: '📏' },
      { policy: AMap.DrivingPolicy.LEAST_FEE, name: '避免收费', icon: '💰' },
    ];

    const routeResults = [];
    let completed = 0;

    policies.forEach((p, index) => {
      const planner = new AMap.Driving({ 
        policy: p.policy,
        hideMarkers: true,
      });

      planner.search(startPos, endPos, (status, result) => {
        completed++;
        
        if (status === 'complete' && result.routes && result.routes.length > 0) {
          routeResults.push({
            index: index,
            policy: p,
            route: result.routes[0],
            result: result,
          });
        }

        if (completed === policies.length) {
          if (routeResults.length > 0) {
            // 按时间排序
            routeResults.sort((a, b) => a.route.time - b.route.time);
            state.allRouteData = routeResults;
            state.selectedRouteIndex = 0;
            
            // 在地图上绘制所有路线
            drawAllRoutesOnMap(routeResults, startPos, endPos);
            // 显示列表
            renderMultipleRoutesList(routeResults);
          } else {
            dom.routeResults.innerHTML = '<div class="result-item"><div class="result-info"><div class="result-name">未找到路线</div></div></div>';
          }
        }
      });
    });
  }

  // ===== 在地图上绘制所有路线 =====
  function drawAllRoutesOnMap(routeResults, startPos, endPos) {
    // 清除旧路线
    state.routePolylines.forEach(line => line.setMap(null));
    state.routeMarkers.forEach(m => m.setMap(null));
    state.routePolylines = [];
    state.routeMarkers = [];

    routeResults.forEach((r, idx) => {
      const route = r.route;
      const color = ROUTE_COLORS[idx] || '#999';
      const isSelected = idx === state.selectedRouteIndex;

      // 构建路径点
      const path = [];
      route.steps.forEach(step => {
        step.path.forEach(p => path.push([p.lng, p.lat]));
      });

      // 绘制路线 - 选中路线粗实线高亮，未选中路线细虚线淡化
      const polyline = new AMap.Polyline({
        path: path,
        strokeColor: isSelected ? '#52c41a' : '#a8d8a0', // 选中深绿，未选中浅绿
        strokeWeight: isSelected ? 10 : 4,
        strokeOpacity: isSelected ? 1 : 0.4,
        strokeStyle: isSelected ? 'solid' : 'dashed',
        lineJoin: 'round',
        lineCap: 'round',
        showDir: isSelected,
        zIndex: isSelected ? 100 : 50,
      });

      state.map.add(polyline);
      state.routePolylines.push(polyline);

      // 在路线中点添加时间标签
      const midIndex = Math.floor(path.length / 2);
      const midPoint = path[midIndex];
      
      const time = Math.ceil(route.time / 60);
      const hours = Math.floor(time / 60);
      const mins = time % 60;
      const timeStr = hours > 0 ? `${hours}h${mins}m` : `${mins}分钟`;
      const distance = (route.distance / 1000).toFixed(1);

      const marker = new AMap.Marker({
        position: midPoint,
        content: `
          <div class="route-label ${isSelected ? 'selected' : ''}" style="
            background: ${color};
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            white-space: nowrap;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            cursor: pointer;
          ">
            ${timeStr} · ${distance}km
          </div>
        `,
        offset: new AMap.Pixel(-40, -10),
        zIndex: isSelected ? 150 : 80,
      });

      // 点击标签选择路线
      marker.on('click', () => {
        selectRoute(idx);
      });

      state.map.add(marker);
      state.routeMarkers.push(marker);

      // 点击路线选择
      polyline.on('click', () => {
        selectRoute(idx);
      });
    });

    // 添加起终点标记
    const startMarker = new AMap.Marker({
      position: startPos,
      content: '<div style="background:#52c41a;color:white;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:bold;">起</div>',
      offset: new AMap.Pixel(-12, -12),
      zIndex: 200,
    });
    const endMarker = new AMap.Marker({
      position: endPos,
      content: '<div style="background:#f5222d;color:white;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:bold;">终</div>',
      offset: new AMap.Pixel(-12, -12),
      zIndex: 200,
    });

    state.map.add([startMarker, endMarker]);
    state.routePolylines.push(startMarker, endMarker);

    // 调整视野
    state.map.setFitView(state.routePolylines.filter(p => p instanceof AMap.Polyline), false, [60, 60, 60, 200]);
  }

  // ===== 选择路线 =====
  function selectRoute(index) {
    if (index === state.selectedRouteIndex) return;
    
    state.selectedRouteIndex = index;
    
    // 重新绘制地图上的路线（切换高亮）
    drawAllRoutesOnMap(state.allRouteData, state.startPos, state.endPos);
    
    // 更新底部卡片选中状态
    document.querySelectorAll('.route-card').forEach((card, idx) => {
      card.classList.toggle('active', idx === index);
    });
    
    // 滚动到选中的卡片
    const selectedCard = document.querySelectorAll('.route-card')[index];
    if (selectedCard) {
      selectedCard.scrollIntoView({ behavior: 'smooth', inline: 'center' });
    }
  }

  // ===== 渲染路线列表 =====
  // 计算红绿灯数量
  function countLights(route) {
    if (!route.steps) return 0;
    return route.steps.filter(s => s.assistant_action && s.assistant_action.includes('红绿灯')).length;
  }

  function renderMultipleRoutesList(routeResults) {
    // 使用底部卡片显示路线
    const cards = document.querySelectorAll('.route-card');
    
    routeResults.forEach((r, idx) => {
      const route = r.route;
      const distance = (route.distance / 1000).toFixed(1);
      const time = Math.ceil(route.time / 60);
      const lights = countLights(route);
      
      // 路线标签
      const labels = ['大众常选', '更近·灯多', '备选三'];
      const label = labels[idx] || '备选';

      const card = cards[idx];
      if (card) {
        card.querySelector('.route-card-time').textContent = `${time}分钟`;
        card.querySelector('.route-card-info').innerHTML = `${distance}公里 <span style="margin:0 4px">·</span> 🚦${lights}`;
        card.querySelector('.route-card-tag').textContent = label;
        
        // 绑定点击事件
        card.onclick = () => {
          selectRoute(idx);
          // 更新卡片选中状态
          cards.forEach(c => c.classList.remove('active'));
          card.classList.add('active');
        };
      }
    });
    
    // 默认选中第一条
    if (cards[0]) cards[0].classList.add('active');
    
    // 显示卡片容器
    dom.routeCards.classList.remove('hidden');
    
    // 原有的路线列表面板内容（保留但不显示）
    dom.routeResults.innerHTML = '';

    // 绑定点击事件
    dom.routeResults.querySelectorAll('.route-option').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        selectRoute(idx);
      });
    });

    // 显示默认路线步骤
    const stepsContainer = dom.routeResults.querySelector('.route-steps');
    if (stepsContainer && routeResults[0]) {
      let stepsHtml = '';
      routeResults[0].route.steps.forEach((step) => {
        stepsHtml += `<div class="route-step">${step.instruction}</div>`;
      });
      stepsContainer.innerHTML = stepsHtml;
    }
  }

  // ===== 单路线规划（公交/步行/骑行） =====
  function planSingleRoute(startPos, endPos, mode) {
    let planner;

    switch (mode) {
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
  }

  function handleRouteResult(status, result, mode) {
    if (status !== 'complete') {
      dom.routeResults.innerHTML = '<div class="result-item"><div class="result-info"><div class="result-name">未找到路线</div></div></div>';
      return;
    }

    let html = '';

    if (mode === 'transit' && result.transits && result.transits.length > 0) {
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
    dom.searchBtn.addEventListener('click', () => {
      searchPlace(dom.searchInput.value);
    });

    dom.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchPlace(dom.searchInput.value);
    });

    [dom.searchInput, dom.routeStart, dom.routeEnd].forEach((input) => {
      input.addEventListener('focus', () => {
        input.select();
      });
    });

    dom.closeSearch.addEventListener('click', closeSearchPanel);

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

    dom.locateBtn.addEventListener('click', getCurrentLocation);

    const trafficBtn = document.getElementById('traffic-btn');
    if (trafficBtn) {
      trafficBtn.addEventListener('click', toggleTraffic);
    }

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
