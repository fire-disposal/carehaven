import { useCallback, useState } from 'react'
import { Switch, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import BottomNav from '@/components/BottomNav'
import Icon from '@/components/Icon'
import type { IconName } from '@/lib/icons'
import { api, getUser, isLoggedIn, type Comment, type Post } from '@/lib/api'
import './index.scss'

const SECTIONS: { key: '经验分享' | '情绪树洞' | '照护技巧'; icon: IconName }[] = [
  { key: '经验分享', icon: 'lightbulb' },
  { key: '情绪树洞', icon: 'cloud-rain' },
  { key: '照护技巧', icon: 'screwdriver-wrench' },
]

type SectionKey = (typeof SECTIONS)[number]['key']

const MAX_LEN = 500

/** 相对时间：中老年用户不习惯看时间戳，统一转成「3 天前」这类说法。 */
function relativeTime(iso: string): string {
  if (!iso) return ''
  const time = new Date(iso.replace(' ', 'T')).getTime()
  if (!Number.isFinite(time)) return ''
  const diff = Date.now() - time
  if (diff < 60000) return '刚刚'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(months / 12)} 年前`
}

/**
 * 署名规则：显式匿名，或历史数据把昵称直接写成「匿名」时，都按匿名展示。
 * 匿名与实名给出双重信号（头像图标 + 虚线标签），不只靠颜色区分。
 */
function personOf(item: { nickname?: string; anonymous?: boolean }): {
  name: string
  anon: boolean
} {
  const raw = typeof item.nickname === 'string' ? item.nickname.trim() : ''
  const anon = item.anonymous === true || raw === '匿名'
  return { name: anon ? '匿名' : raw || '照护者', anon }
}

export default function CommunityPage() {
  const [section, setSection] = useState<SectionKey>('经验分享')
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [likingId, setLikingId] = useState('')
  const [likedIds, setLikedIds] = useState<string[]>([])

  const [openId, setOpenId] = useState('')
  const [commentMap, setCommentMap] = useState<Record<string, Comment[]>>({})
  const [commentLoadingId, setCommentLoadingId] = useState('')
  const [commentError, setCommentError] = useState('')
  const [draft, setDraft] = useState('')
  const [draftAnon, setDraftAnon] = useState(false)
  const [sending, setSending] = useState(false)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [formSection, setFormSection] = useState<SectionKey>('经验分享')
  const [formContent, setFormContent] = useState('')
  const [formAnon, setFormAnon] = useState(false)
  const [formError, setFormError] = useState('')
  const [posting, setPosting] = useState(false)

  const load = useCallback(async (target: SectionKey) => {
    if (!isLoggedIn()) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const items = await api.posts(target)
      setPosts(items)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '内容加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    void load(section)
  })

  function switchSection(next: SectionKey) {
    if (next === section) return
    setSection(next)
    setOpenId('')
    setDraft('')
    setCommentError('')
    void load(next)
  }

  async function loadComments(postId: string) {
    setCommentLoadingId(postId)
    setCommentError('')
    try {
      const items = await api.comments(postId)
      setCommentMap((prev) => ({ ...prev, [postId]: items }))
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : '评论加载失败')
    } finally {
      setCommentLoadingId('')
    }
  }

  async function toggleComments(post: Post) {
    if (openId === post.id) {
      setOpenId('')
      return
    }
    setOpenId(post.id)
    setDraft('')
    setDraftAnon(false)
    setCommentError('')
    if (!commentMap[post.id]) await loadComments(post.id)
  }

  async function like(post: Post) {
    if (likingId || likedIds.indexOf(post.id) >= 0) return
    setLikingId(post.id)
    try {
      const res = await api.likePost(post.id)
      // 点赞数以服务端返回值为准，不做本地 +1
      const likes = typeof res.likes === 'number' ? res.likes : post.likes ?? 0
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, likes } : p)))
      setLikedIds((prev) => [...prev, post.id])
    } catch (e) {
      Taro.showToast({ title: e instanceof Error ? e.message : '点赞失败', icon: 'none' })
    } finally {
      setLikingId('')
    }
  }

  async function sendComment(post: Post) {
    if (sending) return
    const text = draft.trim()
    if (!text) {
      setCommentError('先写下您的想法，再点发表')
      return
    }
    if (text.length > MAX_LEN) {
      setCommentError(`内容不能超过 ${MAX_LEN} 字，请精简后再发`)
      return
    }
    setSending(true)
    setCommentError('')
    try {
      await api.createComment({ postId: post.id, content: text, anonymous: draftAnon })
      setDraft('')
      const items = await api.comments(post.id)
      setCommentMap((prev) => ({ ...prev, [post.id]: items }))
      // 演示数据里的 comments_count 是一次性写入的、服务端不随评论自增，
      // 这里用评论表的真实条数对齐展示，避免发完评论数字不动。
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? { ...p, comments_count: Math.max(p.comments_count ?? 0, items.length) }
            : p
        )
      )
      Taro.showToast({ title: '评论已发布', icon: 'none' })
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : '评论发布失败，请稍后重试')
    } finally {
      setSending(false)
    }
  }

  function openSheet() {
    setFormSection(section)
    setFormContent('')
    setFormAnon(false)
    setFormError('')
    setSheetOpen(true)
  }

  async function submitPost() {
    if (posting) return
    const text = formContent.trim()
    if (!text) {
      setFormError('内容不能为空，写点什么再发布吧')
      return
    }
    if (text.length > MAX_LEN) {
      setFormError(`内容不能超过 ${MAX_LEN} 字，请精简后再发`)
      return
    }
    setPosting(true)
    setFormError('')
    try {
      await api.createPost({
        section: formSection,
        content: text,
        anonymous: formAnon,
        nickname: getUser()?.name ?? '',
      })
      setSheetOpen(false)
      setFormContent('')
      setSection(formSection)
      await load(formSection)
      Taro.showToast({ title: '发布成功，内容仅项目组可见', icon: 'none' })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '发布失败，请稍后重试')
    } finally {
      setPosting(false)
    }
  }

  const me = getUser()
  const showEmpty = !loading && !loadError && posts.length === 0

  return (
    <View className="page">
      <View className="page-pad">
        {/* 分区切换：切换即重新拉取该分区内容 */}
        <View className="seg">
          {SECTIONS.map((item) => (
            <View
              key={item.key}
              className={`seg-item ${item.key === section ? 'on' : ''}`}
              onClick={() => switchSection(item.key)}
            >
              <Icon name={item.icon} size={30} />
              <Text className="seg-label">{item.key}</Text>
            </View>
          ))}
        </View>

        {/* 社区公约：保留合规底线，但按正式产品口吻呈现 */}
        <View className="ugc-notice">
          <Icon name="circle-info" size={32} color="#7a5310" />
          <Text className="ugc-notice-text">
            请尊重他人隐私，不发布可识别个人身份的信息。看到不当内容，可通过「我的 - 意见反馈」举报。
          </Text>
        </View>

        {loadError ? (
          <View className="state-block">
            <Text className="cm-error">{loadError}</Text>
            <View className="btn-ghost state-retry" onClick={() => void load(section)}>
              重新加载
            </View>
          </View>
        ) : null}

        {loading ? (
          <View className="state-block">
            <View className="state-icon">
              <Icon name="clock" size={56} color="#626b65" />
            </View>
            <Text className="state-text">正在加载「{section}」的内容…</Text>
          </View>
        ) : null}

        {showEmpty ? (
          <View className="state-block">
            <View className="state-icon">
              <Icon name="seedling" size={56} color="#1f5a50" />
            </View>
            <Text className="state-text">这个分区还没有人发言</Text>
            <Text className="state-hint">
              您的经验对别人就是帮助。点右下角「发帖」，写下最近照护中的一件事，或只是想说说此刻的心情。
            </Text>
            <View className="btn-primary state-btn" onClick={openSheet}>
              我要发第一条
            </View>
          </View>
        ) : null}

        {!loading && !loadError
          ? posts.map((post) => {
              const who = personOf(post)
              const loaded = commentMap[post.id]
              const count = loaded ? loaded.length : post.comments_count ?? 0
              const opened = openId === post.id
              const liked = likedIds.indexOf(post.id) >= 0
              return (
                <View className="post-card" key={post.id}>
                  <View className="post-head" onClick={() => void toggleComments(post)}>
                    <View className={`avatar ${who.anon ? 'avatar-anon' : ''}`}>
                      {who.anon ? (
                        <Icon name="user" size={32} color="#626b65" />
                      ) : (
                        <Text className="avatar-text">{who.name.slice(0, 1)}</Text>
                      )}
                    </View>
                    <View className="post-who">
                      <Text className={`nick ${who.anon ? 'nick-anon' : ''}`}>{who.name}</Text>
                      <Text className="post-time">{relativeTime(post.created)}</Text>
                    </View>
                    <Text className="pill pill-primary">{post.section || '未分区'}</Text>
                  </View>

                  <View className="post-tap" onClick={() => void toggleComments(post)}>
                    <Text className="post-body">{post.content}</Text>
                  </View>

                  <View className="post-foot">
                    <View
                      className={`act ${liked ? 'liked' : ''} ${likingId === post.id ? 'busy' : ''}`}
                      onClick={() => void like(post)}
                    >
                      <Icon
                        name="heart"
                        size={30}
                        color={liked ? '#963b33' : '#9aa39d'}
                      />
                      <Text className="act-num">{post.likes ?? 0}</Text>
                    </View>
                    <View className="act" onClick={() => void toggleComments(post)}>
                      <Icon name="comment" size={30} color="#9aa39d" />
                      <Text className="act-num">{count}</Text>
                    </View>
                    <Text className="act-more">{opened ? '收起评论' : '写评论'}</Text>
                  </View>

                  {opened ? (
                    <View className="comment-box">
                      {commentLoadingId === post.id ? (
                        <Text className="comment-hint">正在加载评论…</Text>
                      ) : null}

                      {loaded && loaded.length === 0 && commentLoadingId !== post.id ? (
                        <Text className="comment-hint">还没有评论，说句鼓励的话吧</Text>
                      ) : null}

                      {(loaded ?? []).map((c) => {
                        const cw = personOf(c)
                        return (
                          <View className="comment-item" key={c.id}>
                            <View className="row-between">
                              <Text className={`nick-small ${cw.anon ? 'nick-anon' : ''}`}>
                                {cw.name}
                              </Text>
                              <Text className="post-time">{relativeTime(c.created)}</Text>
                            </View>
                            <Text className="comment-body">{c.content}</Text>
                          </View>
                        )
                      })}

                      {commentError ? <Text className="cm-error">{commentError}</Text> : null}

                      <View className="comment-form">
                        <Textarea
                          className="c-area"
                          value={draft}
                          maxlength={MAX_LEN}
                          placeholder="写下您的想法或鼓励…"
                          onInput={(e) => setDraft(e.detail.value)}
                        />
                        <Text className="c-counter">
                          已写 {draft.length} / {MAX_LEN} 字
                        </Text>
                        <View className="c-foot">
                          <View className="switch-line">
                            <Text className="switch-label">匿名发表</Text>
                            <Switch
                              checked={draftAnon}
                              color="#1f5a50"
                              onChange={(e) => setDraftAnon(e.detail.value)}
                            />
                          </View>
                          <View
                            className={`btn-primary c-send ${sending ? 'busy' : ''}`}
                            onClick={() => void sendComment(post)}
                          >
                            {sending ? '发布中…' : '发表'}
                          </View>
                        </View>
                      </View>
                    </View>
                  ) : null}
                </View>
              )
            })
          : null}

        {!loading && !loadError && posts.length > 0 ? (
          <Text className="cm-end">以上是本分区的全部内容</Text>
        ) : null}
      </View>

      {/* 发帖入口 */}
      <View className="fab" onClick={openSheet}>
        <Icon name="pen-to-square" size={30} color="#fff" />
        <Text className="fab-label">发帖</Text>
      </View>

      {sheetOpen ? (
        <View className="sheet-layer">
          <View className="sheet-mask" onClick={() => setSheetOpen(false)} />
          <View className="sheet">
            <View className="sheet-head">
              <Text className="sheet-title">发布新帖</Text>
              <View className="sheet-close" onClick={() => setSheetOpen(false)} ariaRole="button" ariaLabel="关闭">
                <Icon name="xmark" size={34} color="#44504a" />
              </View>
            </View>

            <Text className="sheet-label">发到哪个分区</Text>
            <View className="pick-row">
              {SECTIONS.map((item) => (
                <View
                  key={item.key}
                  className={`pick-item ${item.key === formSection ? 'on' : ''}`}
                  onClick={() => setFormSection(item.key)}
                >
                  <Icon name={item.icon} size={30} />
                  <Text className="pick-label">{item.key}</Text>
                </View>
              ))}
            </View>

            <Text className="sheet-label">想说的话</Text>
            <Textarea
              className="post-area"
              value={formContent}
              maxlength={MAX_LEN}
              placeholder="例如：妈妈昨晚又起来找门，我整夜没睡，今天特别累……"
              onInput={(e) => setFormContent(e.detail.value)}
            />
            <Text className="c-counter">
              已写 {formContent.length} / {MAX_LEN} 字
            </Text>

            <View className="switch-line switch-line-lg">
              <View className="switch-text">
                <Text className="switch-label">匿名发布</Text>
                <Text className="switch-hint">
                  {formAnon
                    ? '其他人只会看到「匿名」，看不到您的名字'
                    : `将以「${me?.name || '照护者'}」的名字发布`}
                </Text>
              </View>
              <Switch
                checked={formAnon}
                color="#1f5a50"
                onChange={(e) => setFormAnon(e.detail.value)}
              />
            </View>

            <View className="ugc-notice ugc-notice-sheet">
              <Icon name="circle-info" size={30} color="#7a5310" />
              <Text className="ugc-notice-text">
                发布即表示同意《用户协议》中的社区规范，请勿包含他人隐私。
              </Text>
            </View>

            {formError ? <Text className="cm-error">{formError}</Text> : null}

            <View className="sheet-actions">
              <View className="btn-ghost sheet-action" onClick={() => setSheetOpen(false)}>
                取消
              </View>
              <View
                className={`btn-primary sheet-action ${posting ? 'busy' : ''}`}
                onClick={() => void submitPost()}
              >
                {posting ? '发布中…' : '发布'}
              </View>
            </View>
          </View>
        </View>
      ) : null}

      <BottomNav active="community" />
    </View>
  )
}
