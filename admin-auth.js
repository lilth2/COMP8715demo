(function () {
  "use strict";
  var KEY = "rd-admin-session-v1";
  var base = ((window.RD_SITE_CONFIG || {}).apiBaseUrl || "").replace(/\/$/, "");
  function readToken() { try { return sessionStorage.getItem(KEY) || ""; } catch (error) { return ""; } }
  function clearToken() { try { sessionStorage.removeItem(KEY); } catch (error) { /* Session will still be revoked on the server. */ } }
  async function request(url, value) {
    if (!base && /\.github\.io$/.test(window.location.hostname)) throw new Error("Administrator login is awaiting backend configuration. Please contact our project team.");
    var headers = {};
    var token = readToken();
    if (token) headers.Authorization = "Bearer " + token;
    if (value !== undefined) headers["Content-Type"] = "application/json";
    var response;
    try {
      response = await fetch(base + "/" + url.replace(/^\//, ""), {
        method: value === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin", headers: headers,
        body: value === undefined ? undefined : JSON.stringify(value)
      });
    } catch (error) { throw new Error("Unable to reach the login service. Please try again later."); }
    var result;
    try { result = await response.json(); } catch (error) { throw new Error("The login service is unavailable. Please contact our project team."); }
    if (!response.ok) {
      if (response.status === 401) clearToken();
      throw new Error(result.message || "Unable to complete the request.");
    }
    return result;
  }
  window.RD_ADMIN_AUTH = {
    session: function () { return request("api/session"); },
    login: async function (username, password) {
      var result = await request("api/login", { username: username, password: password });
      sessionStorage.setItem(KEY, result.token);
      return result;
    },
    logout: async function () { var result = await request("api/logout", {}); clearToken(); return result; },
    request: request
  };
})();
