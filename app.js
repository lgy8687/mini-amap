/**
 * 极简地图 - 从头重写，保证基础功能可用
 */

(function () {
  'use strict';

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/mini-amap/sw.js').catch(function () {});
  }

  // ===== 状态 =====
  var map = null;
  var key = localStorage.getItem('amap_key') || '';
  var securityCode = localStorage.getItem('amap_security') || '';
  var currentLocation = null;
  var searchMarkers = [];
  var routePolylines = [];
  var routeLabels = [];
  var allRouteData = [];
  var selectedRouteIndex = 0;

  // ===== DOM =====
  var searchInput = document.getElementById('search-input');
  var searchBtn = document.getElementById('search-btn');
  var searchPanel = document.getElementById('search-panel');
  var searchResults = document.getElementById('search-results');
  var closeSearch = document.getElementById('close-search');
  var locateBtn = document.getElementById('locate-btn');
  var keyModal = document.getElementById('key-modal');
  var keyInput = document.getElementById('key-input');
  var securityInput = document.getElementById('security-input');
  var saveKey = document.getElementById('save-key');
  var keyError = document.getElementById('key-error');
  var routeCards = document.getElementById('route-cards');

  // ===== 加载地图 =====
  function loadMap() {
    if (window.AMap) {
      initMap();
      return;
    }
    if (!key) {
      keyModal.classList.remove('hidden');
      return;
    }
    if (securityCode) {
      window._AMapSecurityConfig = { securityJsCode: securityCode };
    }
    var s = document.createElement('script');
    s.src = 'https://webapi.amap.com/maps?v=2.0&key=' + key + '&plugin=AMap.Geolocation,AMap.PlaceSearch,AMap.AutoComplete,AMap.Geocoder,AMap.Driving';
    s.onload = function () { initMap(); };
    s.onerror = function () {
      keyError.textContent = '地图加载失败，请检查Key';
      keyModal.classList.remove('hidden');
    };
    document.head.appendChild(s);
  }

  function initMap() {
    map = new AMap.Map('map-container', {
      zoom: 13,
      center: [116.397428, 39.90923],
      resizeEnable: true,
    });
    doLocate();
    map.on('click', function (e) {
      reverseGeocode(e.lnglat);
    });
  }

  // ===== 定位 =====
  function doLocate() {
    if (!map) return;
    var geo = new AMap.Geolocation({ enableHighAccuracy: true, timeout: 10000 });
    geo.getCurrentPosition(function (status, result) {
      if (status === 'complete') {
        currentLocation = result.position;
        map.setCenter(result.position);
      }
    });
  }

  // ===== 逆地理编码 =====
  function reverseGeocode(lnglat) {
    var geocoder = new AMap.Geocoder();
    geocoder.getAddress(lnglat, function (status, result) {
      if (status === 'complete' && result.regeocode) {
        var addr = result.regeocode.formattedAddress;
        showInfoWindow(lnglat, addr);
      }
    });
  }

  // ===== 信息窗口 =====
  function showInfoWindow(lnglat, title) {
    var content = '<div class="info-window">' +
      '<div class="iw-title">' + title + '</div>' +
      '<div class="iw-actions">' +
      '<button class="iw-btn" onclick="window._navFrom(this)" data-lng="' + lnglat.lng + '" data-lat="' + lnglat.lat + '" data-name="' + title + '">导航到这里</button>' +
      '</div></div>';
    var infoWindow = new AMap.InfoWindow({ content: content, offset: new AMap.Pixel(0, -36) });
    infoWindow.open(map, lnglat);
  }

  // 导航到这里（全局函数，给信息窗口按钮用）
  window._navFrom = function (btn) {
    var lng = parseFloat(btn.getAttribute('data-lng'));
    var lat = parseFloat(btn.getAttribute('data-lat'));
    var name = btn.getAttribute('data-name');
    var endLngLat = new AMap.LngLat(lng, lat);
    planRoutes(endLngLat, name);
  };

  // ===== 搜索 =====
  function doSearch(keyword) {
    if (!keyword || !keyword.trim()) return;
    if (!map) {
      searchResults.innerHTML = '<div class="result-item"><div class="result-info"><div class="result-name">地图未加载，请先配置Key</div></div></div>';
      searchPanel.classList.remove('hidden');
      return;
    }

    var autoComplete = new AMap.AutoComplete({ city: '全国' });
    autoComplete.search(keyword, function (status, result) {
      clearSearchMarkers();

      if (status === 'complete' && result.tips && result.tips.length > 0) {
        var tips = result.tips.filter(function (t) { return t.location && t.location.lng; });

        // 按距离排序
        if (currentLocation && tips.length > 0) {
          tips.sort(function (a, b) {
            return currentLocation.distance([a.location.lng, a.location.lat]) - currentLocation.distance([b.location.lng, b.location.lat]);
          });
        }

        var html = '';
        tips.slice(0, 10).forEach(function (tip, i) {
          html += '<div class="result-item" data-lng="' + tip.location.lng + '" data-lat="' + tip.location.lat + '" data-name="' + tip.name + '" data-addr="' + (tip.district || '') + ' ' + (tip.address || '') + '">' +
            '<div class="result-index">' + (i + 1) + '</div>' +
            '<div class="result-info">' +
            '<div class="result-name">' + tip.name + '</div>' +
            '<div class="result-addr">' + (tip.district || '') + ' ' + (tip.address || '') + '</div>' +
            '</div>' +
            '<button class="btn-nav" data-lng="' + tip.location.lng + '" data-lat="' + tip.location.lat + '" data-name="' + tip.name + '">导航</button>' +
            '</div>';
        });
        searchResults.innerHTML = html;

        // 添加地图标记
        tips.slice(0, 10).forEach(function (tip, i) {
          var marker = new AMap.Marker({
            position: [tip.location.lng, tip.location.lat],
            title: tip.name,
            label: { content: '' + (i + 1), direction: 'top' },
          });
          marker.on('click', function () {
            showInfoWindow(new AMap.LngLat(tip.location.lng, tip.location.lat), tip.name);
          });
          searchMarkers.push(marker);
        });
        map.add(searchMarkers);
        if (searchMarkers.length > 0) {
          map.setFitView(searchMarkers, false, [60, 60, 60, 120]);
        }

        // 绑定点击事件
        searchResults.querySelectorAll('.result-item').forEach(function (item) {
          item.addEventListener('click', function (e) {
            if (e.target.classList.contains('btn-nav')) return;
            var lng = parseFloat(item.getAttribute('data-lng'));
            var lat = parseFloat(item.getAttribute('data-lat'));
            var name = item.getAttribute('data-name');
            map.setZoomAndCenter(16, [lng, lat]);
            showInfoWindow(new AMap.LngLat(lng, lat), name);
            searchPanel.classList.add('hidden');
          });
        });

        // 导航按钮
        searchResults.querySelectorAll('.btn-nav').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var lng = parseFloat(btn.getAttribute('data-lng'));
            var lat = parseFloat(btn.getAttribute('data-lat'));
            var name = btn.getAttribute('data-name');
            planRoutes(new AMap.LngLat(lng, lat), name);
            searchPanel.classList.add('hidden');
          });
        });

      } else {
        searchResults.innerHTML = '<div class="result-item"><div class="result-info"><div class="result-name">未找到相关地点</div></div></div>';
      }
      searchPanel.classList.remove('hidden');
    });
  }

  function clearSearchMarkers() {
    searchMarkers.forEach(function (m) { m.setMap(null); });
    searchMarkers = [];
  }

  // ===== 路线规划（三条路线） =====
  function planRoutes(endPos, endName) {
    if (!map) return;

    var startPos = currentLocation;
    if (!startPos) {
      doLocate();
      setTimeout(function () { planRoutes(endPos, endName); }, 2000);
      return;
    }

    clearRouteDisplay();

    var policies = [
      { policy: 0, name: '推荐', tag: '大众常选' },
      { policy: 1, name: '最短', tag: '距离最短' },
      { policy: 5, name: '避堵', tag: '躲避拥堵' },
    ];

    allRouteData = [];
    var completed = 0;

    policies.forEach(function (p, index) {
      var driving = new AMap.Driving({ policy: p.policy, hideMarkers: true });
      driving.search(startPos, endPos, function (status, result) {
        completed++;
        if (status === 'complete' && result.routes && result.routes.length > 0) {
          allRouteData.push({ index: index, route: result.routes[0], policy: p });
        }
        if (completed === 3) {
          if (allRouteData.length > 0) {
            allRouteData.sort(function (a, b) { return a.route.time - b.route.time; });
            selectedRouteIndex = 0;
            drawRoutes();
            updateRouteCards();
          }
        }
      });
    });

    // 添加起终点标记
    var startMarker = new AMap.Marker({
      position: startPos,
      icon: new AMap.Icon({ size: new AMap.Size(24, 34), image: '//webapi.amap.com/theme/v1.3/markers/n/start.png', imageSize: new AMap.Size(24, 34) }),
      offset: new AMap.Pixel(-12, -34),
    });
    var endMarker = new AMap.Marker({
      position: endPos,
      icon: new AMap.Icon({ size: new AMap.Size(24, 34), image: '//webapi.amap.com/theme/v1.3/markers/n/end.png', imageSize: new AMap.Size(24, 34) }),
      offset: new AMap.Pixel(-12, -34),
    });
    map.add([startMarker, endMarker]);
    routeLabels.push(startMarker, endMarker);
  }

  function drawRoutes() {
    // 先清除旧的路线线段
    routePolylines.forEach(function (l) { l.setMap(null); });
    routeLabels.forEach(function (m) {
      if (m.setMap) m.setMap(null);
    });
    routePolylines = [];

    allRouteData.forEach(function (r, idx) {
      var route = r.route;
      var isSelected = (idx === selectedRouteIndex);

      // 构建路径
      var path = [];
      route.steps.forEach(function (step) {
        step.path.forEach(function (p) { path.push([p.lng, p.lat]); });
      });

      // 绘制路线
      var polyline = new AMap.Polyline({
        path: path,
        strokeColor: isSelected ? '#52c41a' : '#a8d8a0',
        strokeWeight: isSelected ? 10 : 4,
        strokeOpacity: isSelected ? 1 : 0.4,
        strokeStyle: isSelected ? 'solid' : 'dashed',
        lineJoin: 'round',
        lineCap: 'round',
        showDir: isSelected,
        zIndex: isSelected ? 100 : 50,
      });
      map.add(polyline);
      routePolylines.push(polyline);

      // 路线上的时间标签
      if (path.length > 0) {
        var midIndex = Math.floor(path.length / 2);
        var midPoint = path[midIndex];
        var time = Math.ceil(route.time / 60);
        var hours = Math.floor(time / 60);
        var mins = time % 60;
        var timeStr = hours > 0 ? hours + 'h' + mins + 'm' : mins + '分钟';

        var label = new AMap.Marker({
          position: midPoint,
          content: '<div style="background:' + (isSelected ? '#52c41a' : '#a8d8a0') + ';color:white;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:500;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.3);">' + timeStr + '</div>',
          offset: new AMap.Pixel(-30, -10),
          zIndex: isSelected ? 150 : 80,
        });
        map.add(label);
        routeLabels.push(label);
      }

      // 点击路线切换
      polyline.on('click', function () {
        selectedRouteIndex = idx;
        drawRoutes();
        updateRouteCards();
      });
    });

    // 调整视野
    if (routePolylines.length > 0) {
      map.setFitView(routePolylines, false, [100, 100, 100, 100]);
    }
  }

  function updateRouteCards() {
    var cards = routeCards.querySelectorAll('.route-card');
    allRouteData.forEach(function (r, idx) {
      var route = r.route;
      var time = Math.ceil(route.time / 60);
      var distance = (route.distance / 1000).toFixed(1);
      var lights = route.steps ? route.steps.filter(function (s) { return s.assistant_action && s.assistant_action.indexOf('红绿灯') >= 0; }).length : 0;
      var card = cards[idx];
      if (card) {
        card.querySelector('.route-card-time').textContent = time + '分钟';
        card.querySelector('.route-card-info').textContent = distance + '公里 · 🚦' + lights;
        card.querySelector('.route-card-tag').textContent = r.policy.tag;
        card.classList.toggle('active', idx === selectedRouteIndex);
      }
    });
    routeCards.classList.remove('hidden');
  }

  function clearRouteDisplay() {
    routePolylines.forEach(function (l) { l.setMap(null); });
    routeLabels.forEach(function (m) { if (m.setMap) m.setMap(null); });
    routePolylines = [];
    routeLabels = [];
    allRouteData = [];
    routeCards.classList.add('hidden');
  }

  // ===== 事件绑定 =====
  searchBtn.addEventListener('click', function () {
    doSearch(searchInput.value);
  });

  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doSearch(searchInput.value);
  });

  searchInput.addEventListener('focus', function () {
    searchInput.select();
  });

  closeSearch.addEventListener('click', function () {
    searchPanel.classList.add('hidden');
  });

  locateBtn.addEventListener('click', function () {
    doLocate();
  });

  // 路线卡片点击
  routeCards.querySelectorAll('.route-card').forEach(function (card) {
    card.addEventListener('click', function () {
      var idx = parseInt(card.getAttribute('data-index'));
      if (allRouteData[idx]) {
        selectedRouteIndex = idx;
        drawRoutes();
        updateRouteCards();
      }
    });
  });

  // Key 保存
  saveKey.addEventListener('click', function () {
    var k = keyInput.value.trim();
    if (!k) { keyError.textContent = '请输入Key'; return; }
    key = k;
    securityCode = securityInput.value.trim();
    localStorage.setItem('amap_key', key);
    localStorage.setItem('amap_security', securityCode);
    keyModal.classList.add('hidden');
    keyError.textContent = '';
    loadMap();
  });

  // ===== 启动 =====
  if (key) {
    loadMap();
  } else {
    keyModal.classList.remove('hidden');
  }

})();
