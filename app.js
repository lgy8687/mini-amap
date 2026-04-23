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
  var currentCity = '';  // 定位所在城市
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
    s.src = 'https://webapi.amap.com/maps?v=2.0&key=' + key + '&plugin=AMap.Geolocation,AMap.PlaceSearch,AMap.Geocoder,AMap.Driving';
    s.onload = function () {
      // 高德 JS API 加载成功不等于 Key 有效，需要检查 AMap 是否真正可用
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
        // 通过逆地理编码获取城市信息，比 Geolocation 的 addressComponent 更可靠
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
        // 直辖市 city 为空，用 province 代替
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

    // 搜索策略：先搜当前城市，再搜全国补充
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

        // 按城市优先排序：所在市 > 所在省 > 全国
        var myCity = currentCity || '';
        var myProvince = '';

        // 提取纯城市名（去掉"市"字），如"广州市"→"广州"，"北京"→"北京"
        var myCityName = myCity.replace(/市$/, '');
        // 提取省份名（去掉"省""市"字），如"广东省"→"广东"，"北京"→"北京"
        myProvince = myCityName;

        // 从城市名推断省份：如用户在"广州市"，省份应为"广东"
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
          '拉萨': '西藏', '银川': '宁夏', '西宁': '青海',
          '海口': '海南', '石家庄': '河北',
        };
        if (cityToProvince[myCityName]) {
          myProvince = cityToProvince[myCityName];
        }

        pois.sort(function (a, b) {
          var aScore = 0, bScore = 0;

          // 所在城市匹配 +3（模糊匹配，"广州"能匹配"广州市"）
          if (myCityName) {
            if ((a.cityname || '').indexOf(myCityName) >= 0) aScore += 3;
            if ((b.cityname || '').indexOf(myCityName) >= 0) bScore += 3;
          }

          // 所在省份匹配 +1
          if (myProvince && myProvince !== myCityName) {
            if ((a.pname || '').indexOf(myProvince) >= 0) aScore += 1;
            if ((b.pname || '').indexOf(myProvince) >= 0) bScore += 1;
          }
          // 直辖市本身既是城市也是省份，额外+1让同省但不同区的也优先
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

  // ===== 路线规划（多条路线，使用策略10综合推荐） =====
  function planRoutes(endPos, endName) {
    if (!map) return;

    var startPos = currentLocation;
    if (!startPos) {
      doLocate();
      setTimeout(function () { planRoutes(endPos, endName); }, 2000);
      return;
    }

    clearRouteDisplay();

    // 使用策略10（综合推荐），高德API会自动返回1~3条不同路线
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

        // 按时间排序，最快的排第一
        allRouteData.sort(function (a, b) { return a.route.time - b.route.time; });
        selectedRouteIndex = 0;
        drawRoutes();
        updateRouteCards();
      } else {
        // 如果综合推荐策略失败，回退到单条路线
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
    // 动态生成路线卡片
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

    // 绑定路线卡片点击事件
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

  searchInput.addEventListener('focus', function () {
    searchInput.select();
  });

  closeSearch.addEventListener('click', function () {
    searchPanel.classList.add('hidden');
  });

  locateBtn.addEventListener('click', function () {
    doLocate();
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
