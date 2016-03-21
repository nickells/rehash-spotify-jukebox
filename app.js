'use strict';
var express       = require('express');
var bodyParser    = require('body-parser');
var request       = require('request');
var SpotifyWebApi = require('spotify-web-api-node');
var config = require(__dirname + '/../rehash-spotify-keys/config.js');
var chalk = require('chalk');

const SPOTIFY_KEY = process.env.SPOTIFY_KEY || config.SPOTIFY_KEY;
const SPOTIFY_SECRET = process.env.SPOTIFY_SECRET || config.SPOTIFY_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || config.SPOTIFY_REDIRECT_URI;
const SLACK_TOKEN = process.env.SLACK_TOKEN || config.SLACK_TOKEN;
const SPOTIFY_USERNAME = process.env.SPOTIFY_USERNAME || config.SPOTIFY_USERNAME;
const SPOTIFY_PLAYLIST_ID = process.env.SPOTIFY_PLAYLIST_ID || config.SPOTIFY_PLAYLIST_ID;
const PORT = process.env.PORT || config.PORT;

var spotifyApi = new SpotifyWebApi({
  clientId     : SPOTIFY_KEY,
  clientSecret : SPOTIFY_SECRET,
  redirectUri  : SPOTIFY_REDIRECT_URI
});

var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));

app.get('/', function(req, res) {
  if (spotifyApi.getAccessToken()) {
    return res.send('You are logged in.');
  }
  return res.send('<a href="/authorise">Authorise</a>');
});

app.get('/authorise', function(req, res) {
  var scopes = ['playlist-modify-public', 'playlist-modify-private'];
  var state  = new Date().getTime();
  var authoriseURL = spotifyApi.createAuthorizeURL(scopes, state);
  res.redirect(authoriseURL);
});

app.get('/callback', function(req, res) {
  spotifyApi.authorizationCodeGrant(req.query.code)
    .then(function(data) {
      spotifyApi.setAccessToken(data.body['access_token']);
      spotifyApi.setRefreshToken(data.body['refresh_token']);
      return res.redirect('/');
    }, function(err) {
      return res.send(err);
    });
});

app.use('/store', function(req, res, next) {
  if (req.body.token !== SLACK_TOKEN) {
    return res.status(500).send('Cross site request forgerizzle!');
  }
  next();
});

app.post('/store', function(req, res) {
  spotifyApi.refreshAccessToken()
    .then(function(data) {
      spotifyApi.setAccessToken(data.body['access_token']);
      if (data.body['refresh_token']) { 
        spotifyApi.setRefreshToken(data.body['refresh_token']);
      }
      if(req.body.text === '!list'){
        spotifyApi.getPlaylist(SPOTIFY_USERNAME, SPOTIFY_PLAYLIST_ID)
        .then(function(data){
          let tracks = data.body.tracks.items;
          let names = tracks.map((item,i)=>{return i + '. ' + item.track.name});
          names = names.join('\n');
          return res.send(names);
        })
      }
      else {
        if(req.body.text.indexOf(' - ') === -1) {
          var query = 'track:' + req.body.text;
        } else { 
          var pieces = req.body.text.split(' - ');
          var query = 'artist:' + pieces[0].trim() + ' track:' + pieces[1].trim();
        }
        spotifyApi.searchTracks(query)
          .then(function(data) {
            var results = data.body.tracks.items;
            if (results.length === 0) {
              return res.send('Could not find that track.');
            }
            var track = results[0];
            spotifyApi.addTracksToPlaylist(SPOTIFY_USERNAME, SPOTIFY_PLAYLIST_ID, ['spotify:track:' + track.id])
              .then(function(data) {
                return res.send('Track added: *' + track.name + '* by *' + track.artists[0].name + '*');
              }, function(err) {
                return res.send(err.message);
              });
          }, function(err) {
            return res.send(err.message);
          });
        }
    }, function(err) {
      return res.send('Could not refresh access token. You probably need to re-authorise yourself from your app\'s homepage.');
    });
});

app.set('port', (PORT || 1337));
app.listen(app.get('port'), function(err){
  if(err) console.log(chalk.red(`Error setting up server on ${app.get('port')}`))
  else console.log(chalk.green(`Listening on port ${app.get('port')}`));
});
