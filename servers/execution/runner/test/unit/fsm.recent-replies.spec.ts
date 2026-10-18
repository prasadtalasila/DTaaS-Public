import { describe, expect, it } from '@jest/globals';
import RecentReplies from 'src/fsm/recent-replies';

describe('Recent replies', () => {
  it('Should keep the request and reply of a key', () => {
    const replies = new RecentReplies<string>();
    replies.add('key-1', 'event stop', 'accepted');

    expect(replies.get('key-1')).toEqual({
      request: 'event stop',
      reply: 'accepted',
    });
    expect(replies.get('key-2')).toBeUndefined();
  });

  it('Should keep nothing for an empty or missing key', () => {
    const replies = new RecentReplies<string>();
    replies.add('', 'event stop', 'accepted');
    replies.add(undefined, 'event stop', 'accepted');

    expect(replies.get('')).toBeUndefined();
    expect(replies.get(undefined)).toBeUndefined();
  });

  it('Should forget the oldest key beyond its limit', () => {
    const replies = new RecentReplies<string>(2);
    replies.add('key-1', 'a', 'one');
    replies.add('key-2', 'b', 'two');
    replies.add('key-3', 'c', 'three');

    expect(replies.get('key-1')).toBeUndefined();
    expect(replies.get('key-2')?.reply).toBe('two');
    expect(replies.get('key-3')?.reply).toBe('three');
  });
});
