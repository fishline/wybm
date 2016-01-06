/**
 * mkvtoolnix utils wrapper. Provides platform-independent Promise API.
 * @module wybm/mkvtoolnix
 */

import assert from "assert";
import {spawn} from "child_process";
import {flatten} from "../util";
if (WIN_BUILD) {
  // TODO(Kagami): Allow to use system mkvinfo.
  require("file?name=[name].[ext]!./mkvinfo.exe");
}

export default {
  _run(runpath, args) {
    let stdout = "";
    let stderr = "";
    return new Promise((resolve, reject) => {
      const p = spawn(runpath, args, {stdio: ["ignore", "pipe", "pipe"]});
      p.stdout.on("data", data => {
        stdout += data;
      });
      p.stderr.on("data", data => {
        stderr += data;
      });
      p.on("error", err => {
        reject(new Error(`Failed to run ${runpath}: ${err.message}`));
      });
      p.on("exit", (code, signal) => {
        // rc=1 means warning for mkvinfo/mkvmerge.
        // Note that mkvtoolnix tools write all info to stdout.
        if (code > 1 || code == null || stderr) {
          return reject(new Error(
            `${runpath} exited with code ${code} (${stdout})`
          ));
        }
        resolve(stdout);
      });
    });
  },
  getStats(fpath) {
    const runpath = WIN_BUILD ? "mkvinfo.exe" : "mkvinfo";
    return this._run(runpath, ["-v", "-v", fpath]).then(out => {
      // Track segment is at level 0.
      const trstart = out.indexOf("\n|+ Segment tracks at ");
      assert(trstart >= 0);
      // Copy until next level 0 element.
      const trend = out.indexOf("\n|+ ", trstart + 1);
      assert(trend >= 0);
      const tracks = out
        .slice(trstart, trend)
        .split("+ A track at ")
        // Skip first useless chunk.
        .slice(1);
      // We need only number of the first video track since it's what
      // browsers display in <video> tag.
      let vid;
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        if (track.indexOf("+ Track type: video") >= 0) {
          vid = track.match(/\+ Track number: (\d+)/)[1];
          break;
        }
      }
      assert(vid);
      // We only need frames info currently.
      // TODO(Kagami): This can't detect keyframes contained inside
      // BlockGroup. "mkvinfo -v -v -v" + "[I frame]" matching is needed
      // for that.
      const framere = new RegExp([
        "\\+ (?:Simple)?Block \\(",
        "(key, )?",
        `track number ${vid},`,
        ".* timecode ([\\d.]+)s",
        ".* at (\\d+)$",
      ].join(""));
      let frames = [];
      out.split("\n").forEach(line => {
        const framem = line.match(framere);
        if (framem) {
          const frame = {
            key: !!framem[1],
            time: +framem[2],
            pos: +framem[3],
          };
          if (!frames.length) return frames.push(frame);
          // Ignore altref in splitted packed[AltRef, P-frame] pair. See
          // <http://permalink.gmane.org/gmane.comp.multimedia.webm.devel/2425>
          // for details.
          // NOTE(Kagami): On the test files I tried such P-frames
          // sometimes have 1ms shift in PTS compared to their
          // accompanied AltRef pair. It's not clear whether this shift
          // might be bigger.
          const last = frames.length - 1;
          // NOTE(Kagami): Seems like this should always be true for
          // WebM since it doesn't have visible B-frames.
          assert(frame.time >= frames[last].time, "Non-monotonic PTS");
          if (frame.time - frames[last].time < 0.002) {
            frames[last] = frame;
          } else {
            frames.push(frame);
          }
        }
      });
      frames.forEach((f, i) => f.index = i);
      assert(frames.length, "No frames");
      return {frames};
    });
  },
};