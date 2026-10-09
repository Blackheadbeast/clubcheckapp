/*
 * ClubCheck online booking: the embed script.
 *
 *   <script src="https://YOUR-CLUBCHECK-DOMAIN/embed/booking.js" data-gym="your-gym" async></script>
 *
 * It puts the gym's booking page into a frame where the script tag is (or inside the element named
 * by data-target), and keeps the frame exactly as tall as its content, so there is never a second
 * scrollbar. The booking page runs in its own frame: its styles cannot touch this page, and this
 * page's styles and scripts cannot touch it.
 */
(function () {
  'use strict'
  var script = document.currentScript
  if (!script) return
  var slug = (script.getAttribute('data-gym') || '').toLowerCase()
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    if (window.console) console.warn('ClubCheck booking: add data-gym="your-booking-address" to the script tag.')
    return
  }
  var origin
  try { origin = new URL(script.src).origin } catch (e) { return }

  var frame = document.createElement('iframe')
  frame.src = origin + '/book/' + slug + '?embed=1'
  frame.title = script.getAttribute('data-title') || 'Book online'
  frame.loading = 'lazy'
  frame.setAttribute('scrolling', 'no')
  frame.setAttribute('allow', 'payment')
  frame.style.cssText = 'display:block;width:100%;max-width:' + (parseInt(script.getAttribute('data-max-width'), 10) || 760) + 'px;margin:0 auto;border:0;overflow:hidden;background:transparent;color-scheme:normal;min-height:420px;height:640px'

  var targetId = script.getAttribute('data-target')
  var target = targetId ? document.getElementById(targetId) : null
  if (target) target.appendChild(frame)
  else if (script.parentNode) script.parentNode.insertBefore(frame, script)

  window.addEventListener('message', function (event) {
    // Only our own frame, from our own origin, may resize or scroll it.
    if (event.origin !== origin || event.source !== frame.contentWindow) return
    var data = event.data
    if (!data || data.slug !== slug) return
    if (data.type === 'clubcheck:booking:height') {
      var height = Number(data.height)
      if (height > 0 && height < 20000) frame.style.height = Math.ceil(height) + 'px'
    } else if (data.type === 'clubcheck:booking:scroll') {
      var top = frame.getBoundingClientRect().top
      if (top < 0 || top > window.innerHeight * 0.6) frame.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  })
})()
