import React, {PropTypes} from 'react';
import withStyles from 'isomorphic-style-loader/lib/withStyles';
import s from './Karaoke.css';
import MyTorrent from '../../components/MyTorrent';

const title = 'Karaoke';

function Karaoke(props, context) {
  context.setTitle(title);
  return (
    <div className={s.root}>
      <div className={s.container}>
        <h1>{title}</h1>
        <MyTorrent/>
      </div>
    </div>
  );
}

Karaoke.contextTypes = {
  setTitle: PropTypes.func.isRequired,
};

export default withStyles(s)(Karaoke);
