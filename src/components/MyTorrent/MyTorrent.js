import React, {Component, PropTypes} from 'react';
import createTorrent from 'create-torrent';
import path from 'path';
import Debug from 'debug';
import WebTorrent from 'webtorrent';
import thunky from 'thunky';
import prettyBytes from 'pretty-bytes';
import throttle from 'throttleit';
import xhr from 'xhr';
import withStyles from 'isomorphic-style-loader/lib/withStyles';
import s from './MyTorrent.css';

const debug = Debug('instant');

global.WEBTORRENT_ANNOUNCE = createTorrent.announceList.map(function(arr) {
  return arr[0];
}).filter(function(url) {
  return url.indexOf('wss://') === 0 || url.indexOf('ws://') === 0;
});

console.log(WebTorrent.WEBRTC_SUPPORT);
if (!WebTorrent.WEBRTC_SUPPORT) {
  // Util.error('This browser is unsupported. Please use a browser with WebRTC support.')
}

var getClient = thunky(function(cb) {
  getRtcConfig('/rtcConfig').then(rtcConfig => {
    createClient(rtcConfig)
  }).catch(error => {
    getRtcConfig('https://instant.io/rtcConfig').then(rtcConfig => {
      createClient(rtcConfig)
    }).catch(error => {
      console.error(error);
    });
  });

  function createClient(rtcConfig) {
    var client = window.client = new WebTorrent({
      tracker: {
        rtcConfig: rtcConfig
      }
    });
    client.on('warning', err => console.error(err.stack || err.message || err));
    client.on('error', err => console.error(err.stack || err.message || err));
    cb(null, client);
  }
});

// For performance, create the client immediately
getClient(function() {});

function isTorrentFile(file) {
  var extname = path.extname(file.name).toLowerCase();
  return extname === '.torrent';
}

function isNotTorrentFile(file) {
  return !isTorrentFile(file);
}

function downloadTorrentFile(file) {
  // Util.log('Downloading torrent from <strong>' + file.name + '</strong>');
  getClient(function(err, client) {
    if (err) {
      return util.error(err);
    }
    client.add(file, onTorrent);
  });
}

function status(response) {
  if (response.status >= 200 && response.status < 300) {
    return Promise.resolve(response.json())
  } else {
    return Promise.reject(new Error(response.statusText))
  }
}

function getRtcConfig(url) {
  return new Promise((resolve, reject) => {
    fetch(url).then(status).then(rtcConfig => {
      debug('got rtc config: %o', rtcConfig);
      resolve(rtcConfig);
    });
  });
}

function truncate(n, len) {
  var ext = n.substring(n.lastIndexOf(".") + 1, n.length).toLowerCase();
  var filename = n.replace('.' + ext, '');
  if (filename.length <= len) {
    return n;
  }
  filename = filename.substr(0, len) + (n.length > len
    ? '...'
    : '');
  return filename + '.' + ext;
}

class SingleTorrent extends Component {

  constructor(props) {
    super(props);
    this.state = {
      progress: 0,
      numPeers: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      files: [],
      downloadFiles: []
    };
  }

  componentWillMount() {
    const {torrent} = this.props;

    torrent.on('warning', err => console.error(err.stack || err.message || err));
    torrent.on('error', err => console.error(err.stack || err.message || err));

    var newFiles = this.state.files.slice();
    torrent.files.forEach(function(file) {
      newFiles.push(`${truncate(file.name, 10)} (${prettyBytes(file.length)})`);
      file.getBlobURL(function (err, url) {
        var newDownloadFiles = this.state.downloadFiles.slice();
        newDownloadFiles.push({name:file.name, url:url});
        this.setState({downloadFiles: newDownloadFiles});
      }.bind(this));
    }.bind(this));
    this.setState({files: newFiles});
    console.log('=newFiles=', newFiles);


    function updateSpeed() {
      this.setState({
        progress: (100 * torrent.progress).toFixed(1),
        numPeers: torrent.numPeers,
        downloadSpeed: prettyBytes(torrent.downloadSpeed),
        uploadSpeed: prettyBytes(torrent.uploadSpeed)
      });
    }

    torrent.on('download', throttle(updateSpeed.bind(this), 250));
    torrent.on('upload', throttle(updateSpeed.bind(this), 250))
    setInterval(updateSpeed.bind(this), 5000);
  }

  render() {
    const {torrent} = this.props;
    const torrentFileName = path.basename(torrent.name, path.extname(torrent.name)) + '.torrent';
    const {progress, numPeers, downloadSpeed, uploadSpeed, files, downloadFiles} = this.state;

    return (
      <tr>
        <td>{numPeers}</td>
        <td>{progress}%</td>
        <td>{downloadSpeed}/s</td>
        <td>{uploadSpeed}/s</td>
        <td>{torrent.infoHash}</td>
        <td>{torrent.files.length}</td>
        <td>
          {files.map((file, index)=>{return <span key={index}>{file}</span>;})}
        </td>
        <td>
          <a href="/#{torrent.infoHash}" onclick="prompt(\'Share this link with anyone you want to download this torrent:\', this.href);return false;">[Share link]</a>
        </td>
        <td>
          <a href={torrent.magnetURI} target="_blank">[Magnet URI]</a>
        </td>
        <td>
          <a href={torrent.torrentFileBlobURL} target="_blank" download={torrentFileName}>[.torrent]</a>
        </td>
        <td>
          {downloadFiles.map((file, index)=>{return <a href={file.url} target="_blank" download={file.name}>Download {file.name}</a>;})}
        </td>
      </tr>
    );
  }
}

class MyTorrent extends Component {

  constructor(props) {
    super(props);
    this.state = {
      torrents: [],
      torrentId: ''
    };
  }

  componentDidMount() {
    var fileNode = this.refs.file;
    fileNode.addEventListener('change', this.handleChange, false);
  }

  render() {
    const {torrents} = this.state;
    var inputStyle = {
      visibility: 'hidden',
      position: 'absolute'
    };

    return (
      <div>
        <div>
          <h2>Start seeding</h2>
          <div className={s.drop_zone} id="drop_zone" onClick={this._onClick.bind(this)} onDragOver={this._onDragover.bind(this)} onDrop={this._onDrop.bind(this)}>Drop files here or click to select files.</div>
          <input style={inputStyle} type="file" ref="file"  onChange={this.handleOnChange.bind(this)} multiple='/'/>
        </div>
        <div>
          <h2>Start downloading</h2>
          <form onSubmit={this.handleDownload.bind(this)}>
            <input className={s.input_torrentId} value={this.state.torrentId} placeholder='magnet:' required onChange={this.handleTorrentId.bind(this)}/>
            <button type='submit'>Download</button>
          </form>
        </div>
        <div>
          <table width="100%">
            <thead>
              <tr>
                <td>Peers</td>
                <td>Progress</td>
                <td>↓</td>
                <td>↑</td>
                <th>InfoHash</th>
                <th>Files</th>
                <th></th>
                <th></th>
                <th></th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {torrents.map((torrent, index) => {
                return <SingleTorrent key={index} torrent={torrent}/>;
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  _onDragover (evt) {
    evt.stopPropagation();
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'copy';
  }

  _onDrop (evt) {
    evt.stopPropagation();
    evt.preventDefault();

    var _files = [];
    for (var i = 0; i < evt.dataTransfer.files.length; i++) {
      _files.push(evt.dataTransfer.files[i]);
    }
    this.onFiles(_files);
  }

  _onClick (evt) {
    evt.stopPropagation();
    evt.preventDefault();

    this.refs.file.click();
  }

  handleOnChange(event) {
    var _files = [];
    for (var i = 0; i < event.target.files.length; i++) {
      _files.push(event.target.files[i]);
    }
    this.onFiles(_files);
  }

  handleTorrentId(event) {
    this.setState({torrentId: event.target.value});
  }

  handleDownload(event){
    event.preventDefault();
    this.downloadTorrent(this.state.torrentId.trim());
  }

  onFiles(files) {
    debug('got files:');
    files.forEach(function(file) {
      debug(' - %s (%s bytes)', file.name, file.size);
    });

    // .torrent file = start downloading the torrent
    files.filter(isTorrentFile).forEach(downloadTorrentFile);

    // Everything else = seed these files
    this.seed(files.filter(isNotTorrentFile));
  }

  downloadTorrent (torrentId) {
    getClient(function (err, client) {
      if (err) {
        // return util.error(err);
      }
      client.add(torrentId, this.onTorrent.bind(this));
    }.bind(this))
  }

  seed(files) {
    if (files.length === 0)
      return
      // Util.log('Seeding ' + files.length + ' files')

    // Seed from WebTorrent
    getClient(function(err, client) {
      if (err) {
        // Return util.error(err)
      }
      client.seed(files, this.onTorrent.bind(this));
    }.bind(this));
  }

  onTorrent(torrent) {
    var newTorrents = this.state.torrents.slice();
    newTorrents.push(torrent);
    this.setState({torrents: newTorrents});
  }
}

export default withStyles(s)(MyTorrent);
