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
  var currentCity = '';
  var searchMarkers = [];
  var routePolylines = [];
  var routeLabels = [];
  var allRouteData = [];
  var selectedRouteIndex = 0;
  var autocompleteTimer = null;  // 输入提示防抖定时器
  var trafficLayer = null;        // 实时路况图层
  var trafficVisible = true;      // 路况默认开启

  // ===== DOM =====
  var searchInput = document.getElementById('search-input');
  var searchBtn = document.getElementById('search-btn');
  var searchPanel = document.getElementById('search-panel');
  var searchResults = document.getElementById('search-results');
  var panelTitle = document.getElementById('panel-title');
  var closeSearch = document.getElementById('close-search');
  var locateBtn = document.getElementById('locate-btn');
  var trafficBtn = document.getElementById('traffic-btn');
  var keyModal = document.getElementById('key-modal');
  var keyInput = document.getElementById('key-input');
  var securityInput = document.getElementById('security-input');
  var saveKey = document.getElementById('save-key');
  var keyError = document.getElementById('key-error');
  var routeCards = document.getElementById('route-cards');

  // ===== HTML 转义 =====
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===== 搜索历史 =====
  var HISTORY_KEY = 'mini-amap-history';
  var MAX_HISTORY = 5;

  function getSearchHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch (e) { return []; }
  }

  function addSearchHistory(keyword) {
    if (!keyword || !keyword.trim()) return;
    var list = getSearchHistory();
    // 去重：如果已存在则移到最前
    var idx = list.indexOf(keyword);
    if (idx >= 0) list.splice(idx, 1);
    list.unshift(keyword);
    // 超过5条删除最旧的
    if (list.length > MAX_HISTORY) list = list.slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  }

  function clearSearchHistory() {
    localStorage.removeItem(HISTORY_KEY);
    showHistoryPanel();
  }

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
    s.onload = function () {
      if (window.AMap && window.AMap.Map) {
        initMap();
      } else {
        keyError.textContent = 'Key 无效，请检查后重新输入';
        keyModal.classList.remove('hidden');
      }
    };
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
    // 默认开启实时路况图层
    trafficLayer = new AMap.TileLayer.Traffic({
      zIndex: 10,
      autoRefresh: true,
      interval: 180,  // 3分钟自动刷新路况数据
    });
    trafficLayer.setMap(map);
    trafficVisible = true;

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
        updateCurrentCity(result.position);
      }
    });
  }

  // ===== 更新当前城市 =====
  function updateCurrentCity(lnglat) {
    var geocoder = new AMap.Geocoder();
    geocoder.getAddress(lnglat, function (status, result) {
      if (status === 'complete' && result.regeocode && result.regeocode.addressComponent) {
        var comp = result.regeocode.addressComponent;
        if (comp.city && comp.city.length > 0) {
          currentCity = comp.city;
        } else if (comp.province && comp.province.length > 0) {
          currentCity = comp.province;
        }
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
    var safeTitle = escapeHtml(title);
    var content = '<div class="info-window">' +
      '<div class="iw-title">' + safeTitle + '</div>' +
      '<div class="iw-actions">' +
      '<button class="iw-btn" onclick="window._navFrom(this)" data-lng="' + lnglat.lng + '" data-lat="' + lnglat.lat + '" data-name="' + safeTitle + '">导航到这里</button>' +
      '</div></div>';
    var infoWindow = new AMap.InfoWindow({ content: content, offset: new AMap.Pixel(0, -36) });
    infoWindow.open(map, lnglat);
  }

  // 导航到这里
  window._navFrom = function (btn) {
    var lng = parseFloat(btn.getAttribute('data-lng'));
    var lat = parseFloat(btn.getAttribute('data-lat'));
    var name = btn.getAttribute('data-name');
    var endLngLat = new AMap.LngLat(lng, lat);
    planRoutes(endLngLat, name);
  };

  // ===== 历史记录面板 =====
  function showHistoryPanel() {
    var list = getSearchHistory();
    if (list.length === 0) {
      searchResults.innerHTML = '<div class="history-empty">暂无搜索记录</div>';
    } else {
      var html = '<div class="history-header"><span>搜索历史</span><button class="history-clear" id="clear-history-btn">清空</button></div>';
      list.forEach(function (kw) {
        html += '<div class="history-item" data-keyword="' + escapeHtml(kw) + '">' +
          '<span class="history-icon">🕐</span>' +
          '<span class="history-text">' + escapeHtml(kw) + '</span>' +
          '</div>';
      });
      searchResults.innerHTML = html;
      // 绑定清空按钮
      var clearBtn = document.getElementById('clear-history-btn');
      if (clearBtn) {
        clearBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          clearSearchHistory();
        });
      }
      // 绑定点击历史
      searchResults.querySelectorAll('.history-item').forEach(function (item) {
        item.addEventListener('click', function () {
          var kw = item.getAttribute('data-keyword');
          searchInput.value = kw;
          doSearch(kw);
        });
      });
    }
    panelTitle.textContent = '搜索';
    searchPanel.classList.remove('hidden');
  }

  // ===== 输入实时提示（AutoComplete） =====
  function showAutocomplete(keyword) {
    if (!map) return;
    var autoComplete = new AMap.AutoComplete({
      city: currentCity || '全国',
      citylimit: false,
    });
    autoComplete.search(keyword, function (status, result) {
      if (status === 'complete' && result.tips && result.tips.length > 0) {
        var tips = result.tips.filter(function (t) { return t.location && t.location.lng; });
        if (tips.length === 0) {
          searchResults.innerHTML = '<div class="history-empty">无匹配结果</div>';
          panelTitle.textContent = '搜索';
          searchPanel.classList.remove('hidden');
          return;
        }

        var html = '';
        tips.slice(0, 8).forEach(function (tip) {
          var addr = (tip.district || '') + (tip.address || '');
          html += '<div class="result-item autocomplete-item" data-lng="' + tip.location.lng + '" data-lat="' + tip.location.lat + '" data-name="' + escapeHtml(tip.name) + '" data-addr="' + escapeHtml(addr) + '">' +
            '<div class="result-info">' +
            '<div class="result-name">' + escapeHtml(tip.name) + '</div>' +
            '<div class="result-addr">' + escapeHtml(addr || '') + '</div>' +
            '</div>' +
            '</div>';
        });
        searchResults.innerHTML = html;
        panelTitle.textContent = '搜索提示';
        searchPanel.classList.remove('hidden');

        // 绑定点击：提示词直接导航，不需要再走搜索结果
        searchResults.querySelectorAll('.autocomplete-item').forEach(function (item) {
          item.addEventListener('click', function () {
            var lng = parseFloat(item.getAttribute('data-lng'));
            var lat = parseFloat(item.getAttribute('data-lat'));
            var name = item.getAttribute('data-name');
            searchInput.value = name;
            addSearchHistory(name);
            searchPanel.classList.add('hidden');
            clearSearchMarkers();
            // 直接规划路线
            var endLngLat = new AMap.LngLat(lng, lat);
            planRoutes(endLngLat, name);
          });
        });
      } else {
        searchResults.innerHTML = '<div class="history-empty">无匹配结果</div>';
        panelTitle.textContent = '搜索';
        searchPanel.classList.remove('hidden');
      }
    });
  }

  // ===== 搜索 =====
  function doSearch(keyword) {
    if (!keyword || !keyword.trim()) return;
    if (!map) {
      searchResults.innerHTML = '<div class="result-item"><div class="result-info"><div class="result-name">地图未加载，请先配置Key</div></div></div>';
      searchPanel.classList.remove('hidden');
      return;
    }

    // 记录搜索历史
    addSearchHistory(keyword.trim());

    var searchCity = currentCity || '全国';
    var placeSearch = new AMap.PlaceSearch({
      pageSize: 10,
      pageIndex: 1,
      city: searchCity,
      citylimit: false,
    });

    placeSearch.search(keyword, function (status, result) {
      clearSearchMarkers();

      if (status === 'complete' && result.poiList && result.poiList.pois && result.poiList.pois.length > 0) {
        var pois = result.poiList.pois;

        // 按城市优先排序
        var myCity = currentCity || '';
        var myCityName = myCity.replace(/市$/, '');
        var myProvince = myCityName;

        var cityToProvince = {
          '广州': '广东', '深圳': '广东', '东莞': '广东', '佛山': '广东',
          '珠海': '广东', '惠州': '广东', '中山': '广东', '汕头': '广东',
          '杭州': '浙江', '宁波': '浙江', '温州': '浙江',
          '南京': '江苏', '苏州': '江苏', '无锡': '江苏', '常州': '江苏',
          '成都': '四川', '武汉': '湖北', '长沙': '湖南', '郑州': '河南',
          '西安': '陕西', '济南': '山东', '青岛': '山东',
          '合肥': '安徽', '福州': '福建', '厦门': '福建',
          '昆明': '云南', '贵阳': '贵州', '南宁': '广西',
          '太原': '山西', '石家庄': '河北', '南昌': '江西',
          '哈尔滨': '黑龙江', '长春': '吉林', '沈阳': '辽宁',
          '兰州': '甘肃', '呼和浩特': '内蒙古', '乌鲁木齐': '新疆',
          '拉萨': '西藏', '银川': '宁夏', '西宁': '青海', '海口': '海南',
        };
        if (cityToProvince[myCityName]) {
          myProvince = cityToProvince[myCityName];
        }

        pois.sort(function (a, b) {
          var aScore = 0, bScore = 0;
          if (myCityName) {
            if ((a.cityname || '').indexOf(myCityName) >= 0) aScore += 3;
            if ((b.cityname || '').indexOf(myCityName) >= 0) bScore += 3;
          }
          if (myProvince && myProvince !== myCityName) {
            if ((a.pname || '').indexOf(myProvince) >= 0) aScore += 1;
            if ((b.pname || '').indexOf(myProvince) >= 0) bScore += 1;
          }
          if (myCityName && myProvince === myCityName) {
            if ((a.pname || '').indexOf(myCityName) >= 0) aScore += 1;
            if ((b.pname || '').indexOf(myCityName) >= 0) bScore += 1;
          }
          return bScore - aScore;
        });

        var html = '';
        pois.slice(0, 10).forEach(function (poi, i) {
          var addr = (poi.pname || '') + (poi.cityname || '') + (poi.adname || '') + (poi.address || '');
          html += '<div class="result-item" data-lng="' + poi.location.lng + '" data-lat="' + poi.location.lat + '" data-name="' + escapeHtml(poi.name) + '" data-addr="' + escapeHtml(addr) + '">' +
            '<div class="result-index">' + (i + 1) + '</div>' +
            '<div class="result-info">' +
            '<div class="result-name">' + escapeHtml(poi.name) + '</div>' +
            '<div class="result-addr">' + escapeHtml(addr || '暂无地址信息') + '</div>' +
            '</div>' +
            '<button class="btn-nav" data-lng="' + poi.location.lng + '" data-lat="' + poi.location.lat + '" data-name="' + escapeHtml(poi.name) + '">导航</button>' +
            '</div>';
        });
        searchResults.innerHTML = html;

        // 添加地图标记
        pois.slice(0, 10).forEach(function (poi, i) {
          var marker = new AMap.Marker({
            position: [poi.location.lng, poi.location.lat],
            title: poi.name,
            label: { content: '' + (i + 1), direction: 'top' },
          });
          marker.on('click', function () {
            showInfoWindow(new AMap.LngLat(poi.location.lng, poi.location.lat), poi.name);
          });
          searchMarkers.push(marker);
        });
        map.add(searchMarkers);
        if (searchMarkers.length > 0) {
          map.setFitView(searchMarkers, false, [60, 60, 60, 120]);
        }

        // 绑定点击事件：点击搜索结果直接导航
        searchResults.querySelectorAll('.result-item').forEach(function (item) {
          item.addEventListener('click', function (e) {
            if (e.target.classList.contains('btn-nav')) return;
            var lng = parseFloat(item.getAttribute('data-lng'));
            var lat = parseFloat(item.getAttribute('data-lat'));
            var name = item.getAttribute('data-name');
            searchPanel.classList.add('hidden');
              clearSearchMarkers();
              planRoutes(new AMap.LngLat(lng, lat), name);
          });
        });

        // 导航按钮（保留，功能同点击）
        searchResults.querySelectorAll('.btn-nav').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var lng = parseFloat(btn.getAttribute('data-lng'));
            var lat = parseFloat(btn.getAttribute('data-lat'));
            var name = btn.getAttribute('data-name');
            searchPanel.classList.add('hidden');
              clearSearchMarkers();
            planRoutes(new AMap.LngLat(lng, lat), name);
          });
        });

      } else {
        searchResults.innerHTML = '<div class="result-item"><div class="result-info"><div class="result-name">未找到相关地点</div></div></div>';
      }
      panelTitle.textContent = '搜索结果';
      searchPanel.classList.remove('hidden');
    });
  }

  function clearSearchMarkers() {
    searchMarkers.forEach(function (m) { m.setMap(null); });
    searchMarkers = [];
  }

  // ===== 路线规划（策略10综合推荐） =====
  function planRoutes(endPos, endName) {
    if (!map) return;

    var startPos = currentLocation;
    if (!startPos) {
      doLocate();
      setTimeout(function () { planRoutes(endPos, endName); }, 2000);
      return;
    }

    clearRouteDisplay();

    var driving = new AMap.Driving({
      policy: 10,
      hideMarkers: true,
    });

    driving.search(startPos, endPos, function (status, result) {
      if (status === 'complete' && result.routes && result.routes.length > 0) {
        var routes = result.routes;
        var policyTags = ['推荐', '备选一', '备选二'];

        routes.forEach(function (route, idx) {
          var tag = idx < policyTags.length ? policyTags[idx] : '备选' + (idx + 1);
          allRouteData.push({ index: idx, route: route, policy: { tag: tag } });
        });

        allRouteData.sort(function (a, b) { return a.route.time - b.route.time; });
        selectedRouteIndex = 0;
        drawRoutes();
        updateRouteCards();
      } else {
        var fallbackDriving = new AMap.Driving({ policy: 0, hideMarkers: true });
        fallbackDriving.search(startPos, endPos, function (fbStatus, fbResult) {
          if (fbStatus === 'complete' && fbResult.routes && fbResult.routes.length > 0) {
            allRouteData.push({ index: 0, route: fbResult.routes[0], policy: { tag: '推荐' } });
            selectedRouteIndex = 0;
            drawRoutes();
            updateRouteCards();
          }
        });
      }
    });

    // 起终点标记
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
    routePolylines.forEach(function (l) { l.setMap(null); });
    routeLabels.forEach(function (m) {
      if (m.setMap) m.setMap(null);
    });
    routePolylines = [];
    // 保留起终点标记
    var startEndMarkers = routeLabels.slice(0, 2);
    routeLabels = startEndMarkers;

    allRouteData.forEach(function (r, idx) {
      var route = r.route;
      var isSelected = (idx === selectedRouteIndex);

      // 构建路径
      var path = [];
      route.steps.forEach(function (step) {
        step.path.forEach(function (p) { path.push([p.lng, p.lat]); });
      });

      // 高德风格配色：全绿色，选中深绿粗线，未选中浅绿细线，全部实线可见
      var polyline = new AMap.Polyline({
        path: path,
        strokeColor: isSelected ? '#1AAD19' : '#5EC776',
        strokeWeight: isSelected ? 10 : 5,
        strokeOpacity: isSelected ? 1 : 0.7,
        strokeStyle: 'solid',
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

        // 标签颜色跟随路线颜色
        var labelBg = isSelected ? '#1AAD19' : '#5EC776';
        var label = new AMap.Marker({
          position: midPoint,
          content: '<div style="background:' + labelBg + ';color:white;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:500;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.3);">' + timeStr + '</div>',
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

    if (routePolylines.length > 0) {
      map.setFitView(routePolylines, false, [100, 100, 100, 100]);
    }
  }

  function updateRouteCards() {
    var html = '';
    allRouteData.forEach(function (r, idx) {
      var route = r.route;
      var time = Math.ceil(route.time / 60);
      var distance = (route.distance / 1000).toFixed(1);
      var lights = route.steps ? route.steps.filter(function (s) { return s.assistant_action && s.assistant_action.indexOf('红绿灯') >= 0; }).length : 0;
      var hours = Math.floor(time / 60);
      var mins = time % 60;
      var timeStr = hours > 0 ? hours + 'h' + mins + 'm' : mins + '分钟';

      html += '<div class="route-card' + (idx === selectedRouteIndex ? ' active' : '') + '" data-index="' + idx + '">' +
        '<div class="route-card-time">' + timeStr + '</div>' +
        '<div class="route-card-info">' + distance + '公里 · 🚦' + lights + '</div>' +
        '<div class="route-card-tag">' + r.policy.tag + '</div>' +
        '</div>';
    });
    routeCards.innerHTML = html;

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

  // 搜索框聚焦：空内容显示历史，有内容显示提示
  searchInput.addEventListener('focus', function () {
    searchInput.select();
    if (!searchInput.value.trim()) {
      showHistoryPanel();
    }
  });

  // 输入时实时提示（300ms 防抖）
  searchInput.addEventListener('input', function () {
    var val = searchInput.value.trim();

    // 清掉之前的定时器
    if (autocompleteTimer) {
      clearTimeout(autocompleteTimer);
      autocompleteTimer = null;
    }

    if (!val) {
      // 输入框清空，显示历史
      showHistoryPanel();
      return;
    }

    if (!map) return;

    // 300ms 防抖
    autocompleteTimer = setTimeout(function () {
      showAutocomplete(val);
    }, 300);
  });

  closeSearch.addEventListener('click', function () {
    searchPanel.classList.add('hidden');
  });

  locateBtn.addEventListener('click', function () {
    doLocate();
  });

  // 路况开关
  trafficBtn.addEventListener('click', function () {
    if (!trafficLayer) return;
    if (trafficVisible) {
      trafficLayer.setMap(null);
      trafficVisible = false;
      trafficBtn.classList.remove('active');
    } else {
      trafficLayer.setMap(map);
      trafficVisible = true;
      trafficBtn.classList.add('active');
    }
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
