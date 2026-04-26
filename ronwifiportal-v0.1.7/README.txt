RONwifi Portal v0.1.7 — CNA Auto-Popup Fix
============================================

CHANGES FROM v0.1.4:
--------------------
1. login.html — reduced to 2-line stub that redirects to ronwifi.html
   - Preserves $(error) rendering for failed login attempts
   - Adds cache-busting timestamp to prevent stale page loads

2. redirect.html — NEW FILE (required for CNA auto-popup)
   - Contains MikroTik magic strings that trigger HTTP 302 detection
   - iOS/Android/Windows Captive Network Assistants sniff for this

3. rlogin.html — NEW FILE (required for CNA auto-popup)
   - Same magic strings as redirect.html
   - Handles redirect-after-login flow


DEPLOYMENT:
-----------
1. Upload these 3 files to MikroTik at /flash/ronwifiportal/
   - login.html (overwrites existing)
   - redirect.html (new)
   - rlogin.html (new)

2. Keep your existing files unchanged:
   - ronwifi.html (main UI)
   - ronwifi.js
   - ronwifi.css
   - settings.js
   - alogin.html
   - error.html
   - status.html
   - logout.html

3. No RouterOS config changes needed


TESTING:
--------
1. Connect a fresh device (forget WiFi network first)
2. Join the SSID
3. Captive portal should auto-popup within 3-5 seconds
4. If it doesn't popup: manually browse to http://10.0.0.1
   - Should redirect to /ronwifi.html automatically
   - No more 404 error

5. Test on all 3 platforms:
   - iOS (Safari captive popup)
   - Android (Chrome/system captive popup)
   - Windows (Edge captive popup)


ROLLBACK (if needed):
---------------------
Restore your old v0.1.4 login.html from backup.
Delete redirect.html and rlogin.html.


NOTES:
------
- The stub pattern (login.html → ronwifi.html) matches JuanFi architecture
- This lets you maintain ONE UI file (ronwifi.html) instead of duplicates
- MikroTik template vars $(mac), $(ip), etc. still work in ronwifi.html
- Cache-busting via timestamp prevents iOS/Android from caching old portal
