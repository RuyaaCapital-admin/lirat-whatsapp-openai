[33mcommit 9e34196859358d3241205e8dd0973eb096d24b88[m[33m ([m[1;36mHEAD[m[33m -> [m[1;32mmain[m[33m, [m[1;31morigin/main[m[33m, [m[1;31morigin/HEAD[m[33m)[m
Author: RuyaaCapital-admin <admin@ruyaacapital.com>
Date:   Fri Oct 24 02:26:30 2025 +0400

    FIX: Implement proper WhatsApp typing indicators per official API docs
    
    - Update sendTyping to use correct API endpoint with message_id parameter
    - Create markReadAndShowTyping function to combine read + typing in single call
    - Follow WhatsApp Cloud API documentation exactly:
      * Use POST /messages endpoint with status: 'read' + typing_indicator
      * Require message_id from webhook payload
      * Auto-dismiss after 25 seconds or when response sent
    - Optimize webhook to use single API call instead of two separate calls
    - Maintain error handling with graceful fallbacks
    - Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/typing-indicators/

 src/lib/waba.ts          | 27 [32m+++++++++++++++++++[m[31m--------[m
 src/pages/api/webhook.js | 15 [32m++++[m[31m-----------[m
 2 files changed, 23 insertions(+), 19 deletions(-)
