module.exports = function(mongo) {
  if(!mongo) {
    throw 'Missing mongo';
  }

  var url = 'http://' + (process.env.NODE_ENV === 'production' ? 'kpjs.azurewebsites.net' : 'localhost:1337');
  var passport = require('passport');
  var GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
  var GithubStrategy = require('passport-github').Strategy;
  var TwitterStrategy = require('passport-twitter').Strategy;
  var FacebookStrategy = require('passport-facebook').Strategy;

  passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: url + '/login/google/callback',
      state: true
    },
    authCallback(function(p) { return p.photos[0].value; })
  ));

  passport.use(new GithubStrategy({
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: url + '/login/github/callback',
      state: true
    },
    //jscs:disable requireCamelCaseOrUpperCaseIdentifiers
    authCallback(function(p) { return p._json.avatar_url; })
    //jscs:enable requireCamelCaseOrUpperCaseIdentifiers
  ));

  passport.use(new TwitterStrategy({
      consumerKey: process.env.TWITTER_CLIENT_ID,
      consumerSecret: process.env.TWITTER_CLIENT_SECRET,
      callbackURL: url + '/login/twitter/callback',
      state: true
    },
    authCallback(function(p) { return p.photos[0].value; })
  ));

  passport.use(new FacebookStrategy({
      clientID: process.env.FACEBOOK_CLIENT_ID,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
      callbackURL: url + '/login/facebook/callback',
      profileFields: [ 'displayName', 'photos' ],
      state: true
    },
    authCallback(function(p) { return p.photos[0].value; })
  ));

  passport.serializeUser(function(user, done) {
    done(null, user);
  });

  passport.deserializeUser(function(obj, done) {
    done(null, obj);
  });

  return {
    setup: setup,
    ensureOwner: ensureOwner,
    ensureZombie: ensureRoleReguestHandlerWrapper(0),
    ensureCitizen: ensureRoleReguestHandlerWrapper(1),
    ensureRuler: ensureRoleReguestHandlerWrapper(2)
  };

  function authCallback(avatarCallback){
    return function(token, tokenSecret, profile, done) {
      mongo.collection('users').findAndModify({ provider: profile.provider, providerId: profile.id }, [], { $setOnInsert: { name: profile.displayName, role: 0 } }, { new: true, upsert: true },
        function(err, item){
          if(err){ return done(err); }
          var avatarUrl;
          try { avatarUrl = avatarCallback(profile); } catch(e) {}
          return done(null, { id: item.value._id, name: item.value.name, avatarUrl: avatarUrl });
        });
    };
  }

  function setup(expressApp){
    if(!expressApp)
    {
      throw 'Missing express app';
    }
    expressApp.use(passport.initialize());
    expressApp.use(passport.session());
    expressApp.get('/login/google', passport.authenticate('google', { scope: 'profile' }));
    expressApp.get('/login/github', passport.authenticate('github'));
    expressApp.get('/login/twitter', passport.authenticate('twitter'));
    expressApp.get('/login/facebook', passport.authenticate('facebook'));
    expressApp.get('/login/google/callback',
      passport.authenticate('google', { failureRedirect: '/loginFail', successRedirect: '/' })
    );
    expressApp.get('/login/github/callback',
      passport.authenticate('github', { failureRedirect: '/loginFail', successRedirect: '/' })
    );
    expressApp.get('/login/twitter/callback',
      passport.authenticate('twitter', { failureRedirect: '/loginFail', successRedirect: '/' })
    );
    expressApp.get('/login/facebook/callback',
      passport.authenticate('facebook', { failureRedirect: '/loginFail', successRedirect: '/' })
    );
    expressApp.get('/logout', function(req, res){
      req.logout();
      req.session.regenerate(function(){
         res.redirect('/');
       });
     });
     expressApp.get('/loginFail', function(req, res){ res.end('login failed'); });
  }

  function verifyRole(userId, role, callback){
    var ObjectID = require('mongodb').ObjectID;
    mongo.collection('users').findOne({ _id: new ObjectID(userId) }, { role: 1 }, function(err, item){
      if(err){
        return callback(err);
      }
      if(item.role >= role){
        callback(null, true);
      }
      else{
        callback(null, false);
      }
    });
  }

  function ensureRoleReguestHandlerWrapper(role){
    return function(req, res, next){
      if(!req.isAuthenticated()){
        var error = new Error("Not logged in");
        error.statusCode = 401;
        return next(error);
      }
      verifyRole(req.user.id, role, function(err, hasRole){
        if(err){
          return next(err);
        }
        if(hasRole){
          next();
        }
        else{
          var error = new Error("Not authorized");
          error.statusCode = 403;
          next(error);
        }
      });
    };
  }

  function ensureOwner(req, res, next){
    if(!req.isAuthenticated()){
      var error = new Error("Not logged in");
      error.statusCode = 401;
      return next(error);
    }
    var ObjectID = require('mongodb').ObjectID;
    // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
    mongo.collection('posts').count({ users_id: new ObjectID(req.user.id), uri: req.params.uri }, function(err, count){
      if(count > 0){
        return next();
      }
      var error = new Error("Not authorized");
      error.statusCode = 403;
      return next(error);
    });
  }
};
