/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-2016 Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import 'babel-polyfill';
import path from 'path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import expressJwt from 'express-jwt';
import expressGraphQL from 'express-graphql';
import jwt from 'jsonwebtoken';
import ReactDOM from 'react-dom/server';
import UniversalRouter from 'universal-router';
import PrettyError from 'pretty-error';
import unlimited from 'unlimited';
import downgrade from 'downgrade';
import url from 'url';
import twilio from 'twilio';
import compress from 'compression';
import passport from './core/passport';
import models from './data/models';
import schema from './data/schema';
import routes from './routes';
import assets from './assets'; // eslint-disable-line import/no-unresolved
import {
  port,
  auth,
  analytics,
  twilio as twilioConfig,
  CORS_WHITELIST
} from './config';

const app = express();

//
// Tell any CSS tooling (such as Material UI) to use all vendor prefixes if the
// user agent is not known.
// -----------------------------------------------------------------------------
global.navigator = global.navigator || {};
global.navigator.userAgent = global.navigator.userAgent || 'all';

//
// Upgrade the maximum file descriptor number (`'nofile'`) that can be opened
// by this process
// -----------------------------------------------------------------------------
unlimited();

//
// Node.js compression middleware
// -----------------------------------------------------------------------------
app.use(compress());

//
// Register Node.js middleware
// -----------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

//
// Custom header
// -----------------------------------------------------------------------------
app.use((req, res, next) => { // eslint-disable-line no-unused-vars
  // Use HTTP Strict Transport Security
  // Lasts 1 year, incl. subdomains, allow browser preload list
  if (process.env.NODE_ENV === 'production') {
    res.header(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  // Add cross-domain header for fonts, required by spec, Firefox, and IE.
  var extname = path.extname(url.parse(req.url).pathname);
  if (['.eot', '.ttf', '.otf', '.woff', '.woff2'].indexOf(extname) >= 0) {
    res.header('Access-Control-Allow-Origin', '*');
  }

  // Prevents IE and Chrome from MIME-sniffing a response. Reduces exposure to
  // drive-by download attacks on sites serving user uploaded content.
  res.header('X-Content-Type-Options', 'nosniff');

  // Prevent rendering of site within a frame.
  res.header('X-Frame-Options', 'DENY');

  // Enable the XSS filter built into most recent web browsers. It's usually
  // enabled by default anyway, so role of this headers is to re-enable for this
  // particular website if it was disabled by the user.
  res.header('X-XSS-Protection', '1; mode=block');

  // Force IE to use latest rendering engine or Chrome Frame
  res.header('X-UA-Compatible', 'IE=Edge,chrome=1');

  next();
});

//
// Fetch new ice_servers from twilio token regularly
// -----------------------------------------------------------------------------
var iceServers;
var twilioClient;
try {
  twilioClient = twilio(twilioConfig.accountSid, twilioConfig.authToken);
} catch (err) {}

function updateIceServers() {
  twilioClient.tokens.create({}, (err, token) => {
    if (err) {
      return error(err);
    }

    /* jscs:disable requireCamelCaseOrUpperCaseIdentifiers */
    if (!token.ice_servers) {
      /* jscs:enable requireCamelCaseOrUpperCaseIdentifiers */
      return error(new Error('twilio response ' + token + ' missing ice_servers'));
    }

    /* jscs:disable requireCamelCaseOrUpperCaseIdentifiers */
    iceServers = token.ice_servers.filter(function(server) {
      /* jscs:enable requireCamelCaseOrUpperCaseIdentifiers */
      var urls = server.urls || server.url;
      return urls && !/^stun:/.test(urls);
    });
    iceServers.unshift({
      url: 'stun:23.21.150.121',
    });

    // Support new spec (`RTCIceServer.url` was renamed to `RTCIceServer.urls`)
    iceServers = iceServers.map(function(server) {
      if (server.urls === undefined) {
        server.urls = server.url;
      }
      return server;
    });
  });
}

if (twilioClient) {
  setInterval(updateIceServers, twilioConfig.UPDATE_TIME_PERIORD).unref();
  updateIceServers();
}

//
// Authentication
// -----------------------------------------------------------------------------
app.use(expressJwt({
  secret: auth.jwt.secret,
  credentialsRequired: false,
  /* jscs:disable requireCamelCaseOrUpperCaseIdentifiers */
  getToken: req => req.cookies.id_token,
  /* jscs:enable requireCamelCaseOrUpperCaseIdentifiers */
}));
app.use(passport.initialize());

app.get('/login/facebook',
  passport.authenticate('facebook', { scope: ['email', 'user_location'], session: false })
);
app.get('/login/facebook/return',
  passport.authenticate('facebook', { failureRedirect: '/login', session: false }),
  (req, res) => {
    const expiresIn = 60 * 60 * 24 * 180; // 180 days
    const token = jwt.sign(req.user, auth.jwt.secret, { expiresIn });
    res.cookie('id_token', token, { maxAge: 1000 * expiresIn, httpOnly: true });
    res.redirect('/');
  }
);

//
// Register API middleware
// -----------------------------------------------------------------------------
app.use('/graphql', expressGraphQL(req => ({
  schema,
  graphiql: true,
  rootValue: { request: req },
  pretty: process.env.NODE_ENV !== 'production',
})));

//
// Register rtcConfig route
// -----------------------------------------------------------------------------
app.get('/rtcConfig', cors({
  origin: (origin, cb) => {
    var allowed = CORS_WHITELIST.indexOf(origin) >= 0 ||
      /https?:\/\/localhost(:|$)/.test(origin) ||
      /https?:\/\/[^.\/]+\.localtunnel\.me$/.test(origin);
    cb(null, allowed);
  },
}), (req, res) => {
  if (!iceServers) {
    res.status(404).send({
      iceServers: [],
    });
  } else {
    res.send({
      iceServers: iceServers,
    });
  }
});

//
// Register server-side rendering middleware
// -----------------------------------------------------------------------------
app.get('*', async (req, res, next) => {
  try {
    let css = [];
    let statusCode = 200;
    const template = require('./views/index.jade'); // eslint-disable-line global-require
    const data = { title: '', description: '', css: '', body: '', entry: assets.main.js };

    if (process.env.NODE_ENV === 'production') {
      data.trackingId = analytics.google.trackingId;
    }

    await UniversalRouter.resolve(routes, {
      path: req.path,
      query: req.query,
      context: {
        insertCss: (...styles) => {
          styles.forEach(style => css.push(style._getCss())); // eslint-disable-line no-underscore-dangle, max-len
        },
        setTitle: value => (data.title = value),
        setMeta: (key, value) => (data[key] = value),
      },
      render(component, status = 200) {
        css = [];
        statusCode = status;
        data.body = ReactDOM.renderToString(component);
        data.css = css.join('');
        return true;
      },
    });

    res.status(statusCode);
    res.send(template(data));
  } catch (err) {
    next(err);
  }
});

//
// Error handling
// -----------------------------------------------------------------------------
const pe = new PrettyError();
pe.skipNodeFiles();
pe.skipPackage('express');

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.log(pe.render(err)); // eslint-disable-line no-console
  const template = require('./views/error.jade'); // eslint-disable-line global-require
  const statusCode = err.status || 500;
  res.status(statusCode);
  res.send(template({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? '' : err.stack,
  }));
});

//
// Launch the server
// -----------------------------------------------------------------------------
/* eslint-disable no-console */
models.sync().catch(err => console.error(err.stack)).then(() => {
  app.listen(port, () => {
    console.log(`The server is running at http://localhost:${port}/`);

    downgrade();
  });
});
/* eslint-enable no-console */
