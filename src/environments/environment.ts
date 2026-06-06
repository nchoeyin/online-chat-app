export const environment = {
  production: false,
  // IMPORTANT: this hostname must match the one in the browser's address bar
  // for the Angular dev server (which is `localhost` by default). Using a
  // different hostname here (e.g. 127.0.0.1) makes browsers treat API calls
  // as cross-site and drop the `sessionid` cookie under SameSite=Lax,
  // which breaks any flow that depends on session state (notably OAuth).
  apiBaseUrl: 'http://localhost:8000/api',
};
