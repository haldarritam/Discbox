#!/usr/bin/env python3
"""
LikedFM metadata tagger
Usage: python3 tagger.py <json_file>
JSON fields: filepath, artist, title, album, album_art_url, contributors,
             track_position, disk_number, release_date, bpm, isrc
"""

import sys
import os
import json
import urllib.request

def download_art(url):
    if not url or url.strip() in ('', 'null'):
        return None
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.read()
    except Exception as e:
        print(f"[tagger] Art download failed: {e}", file=sys.stderr)
        return None

def get_year(release_date):
    if not release_date:
        return None
    return release_date.split('-')[0]

def tag_mp3(filepath, meta, art_data):
    from mutagen.id3 import (ID3, TIT2, TPE1, TALB, APIC, TRCK, TPOS,
                              TDRC, TBPM, TSRC, TPE2, ID3NoHeaderError)
    try:
        tags = ID3(filepath)
    except ID3NoHeaderError:
        tags = ID3()
    tags.clear()
    tags.add(TIT2(encoding=3, text=meta['title']))
    tags.add(TPE1(encoding=3, text=meta.get('contributors') or meta['artist']))
    tags.add(TPE2(encoding=3, text=meta['artist']))
    if meta.get('album'):
        tags.add(TALB(encoding=3, text=meta['album']))
    if meta.get('track_position'):
        track = str(meta['track_position'])
        tags.add(TRCK(encoding=3, text=track))
    if meta.get('disk_number'):
        tags.add(TPOS(encoding=3, text=str(meta['disk_number'])))
    if meta.get('release_date'):
        tags.add(TDRC(encoding=3, text=get_year(meta['release_date'])))
    if meta.get('bpm'):
        tags.add(TBPM(encoding=3, text=str(int(meta['bpm']))))
    if meta.get('isrc'):
        tags.add(TSRC(encoding=3, text=meta['isrc']))
    if art_data:
        tags.add(APIC(encoding=3, mime='image/jpeg', type=3,
                      desc='Cover', data=art_data))
    tags.save(filepath)

def tag_flac(filepath, meta, art_data):
    from mutagen.flac import FLAC, Picture
    audio = FLAC(filepath)
    audio.clear()
    audio['title'] = meta['title']
    audio['artist'] = meta.get('contributors') or meta['artist']
    audio['albumartist'] = meta['artist']
    if meta.get('album'):
        audio['album'] = meta['album']
    if meta.get('track_position'):
        audio['tracknumber'] = str(meta['track_position'])
    if meta.get('disk_number'):
        audio['discnumber'] = str(meta['disk_number'])
    if meta.get('release_date'):
        audio['date'] = get_year(meta['release_date'])
    if meta.get('bpm'):
        audio['bpm'] = str(int(meta['bpm']))
    if meta.get('isrc'):
        audio['isrc'] = meta['isrc']
    if art_data:
        pic = Picture()
        pic.type = 3
        pic.mime = 'image/jpeg'
        pic.data = art_data
        audio.add_picture(pic)
    audio.save()

def tag_m4a(filepath, meta, art_data):
    from mutagen.mp4 import MP4, MP4Cover
    audio = MP4(filepath)
    audio.clear()
    audio['\xa9nam'] = [meta['title']]
    audio['\xa9ART'] = [meta.get('contributors') or meta['artist']]
    audio['aART'] = [meta['artist']]
    if meta.get('album'):
        audio['\xa9alb'] = [meta['album']]
    if meta.get('track_position'):
        audio['trkn'] = [(meta['track_position'], 0)]
    if meta.get('disk_number'):
        audio['disk'] = [(meta['disk_number'], 0)]
    if meta.get('release_date'):
        audio['\xa9day'] = [get_year(meta['release_date'])]
    if meta.get('bpm'):
        audio['tmpo'] = [int(meta['bpm'])]
    if art_data:
        audio['covr'] = [MP4Cover(art_data, imageformat=MP4Cover.FORMAT_JPEG)]
    audio.save()

def tag_opus(filepath, meta, art_data):
    from mutagen.oggvorbis import OggVorbis
    audio = OggVorbis(filepath)
    audio.clear()
    audio['title'] = [meta['title']]
    audio['artist'] = [meta.get('contributors') or meta['artist']]
    audio['albumartist'] = [meta['artist']]
    if meta.get('album'):
        audio['album'] = [meta['album']]
    if meta.get('track_position'):
        audio['tracknumber'] = [str(meta['track_position'])]
    if meta.get('release_date'):
        audio['date'] = [get_year(meta['release_date'])]
    if meta.get('bpm'):
        audio['bpm'] = [str(int(meta['bpm']))]
    if meta.get('isrc'):
        audio['isrc'] = [meta['isrc']]
    audio.save()

def tag_file(meta):
    filepath = meta['filepath']
    ext = os.path.splitext(filepath)[1].lower()
    art_data = download_art(meta.get('album_art_url'))

    try:
        if ext == '.mp3':
            tag_mp3(filepath, meta, art_data)
        elif ext == '.flac':
            tag_flac(filepath, meta, art_data)
        elif ext in ['.m4a', '.mp4']:
            tag_m4a(filepath, meta, art_data)
        elif ext == '.opus':
            tag_opus(filepath, meta, art_data)
        else:
            print(f"[tagger] Unsupported format: {ext}", file=sys.stderr)
            return False
        print(f"[tagger] Tagged: {filepath}")
        return True
    except Exception as e:
        print(f"[tagger] Error: {e}", file=sys.stderr)
        return False

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: tagger.py <json_file>")
        sys.exit(1)

    with open(sys.argv[1], 'r') as f:
        meta = json.load(f)

    sys.exit(0 if tag_file(meta) else 1)
