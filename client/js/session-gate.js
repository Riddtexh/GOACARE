// Runs in <head> before first paint: hide the app until the user signs in.
try { if (!sessionStorage.getItem('gcSessionAuth')) document.documentElement.classList.add('gc-locked'); }
catch (e) { document.documentElement.classList.add('gc-locked'); }
