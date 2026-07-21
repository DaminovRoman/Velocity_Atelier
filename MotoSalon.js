/* ================================================================
   VELOCITY ATELIER — Interaction Layer
   Vanilla JS. No dependencies. IntersectionObserver + rAF driven.
   ================================================================ */

(function () {
  'use strict';

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;

  /* ------------------------------------------------------------
     UTIL: throttle via requestAnimationFrame
     Purpose: cap expensive scroll/mousemove handlers to one
     execution per paint frame, avoiding layout thrash
     ------------------------------------------------------------ */
  function rafThrottle(fn) {
    var ticking = false;
    return function () {
      var args = arguments;
      var ctx = this;
      if (!ticking) {
        window.requestAnimationFrame(function () {
          fn.apply(ctx, args);
          ticking = false;
        });
        ticking = true;
      }
    };
  }

  /* ==============================================================
     1. PRELOADER
     Trigger: window 'load' event (+ enforced minimum display time)
     Duration: --dur-slow (680ms) fade, defined in CSS
     Purpose: masks initial asset/font pop-in behind a branded
     moment rather than letting the layout paint piecemeal
     ============================================================== */
  (function preloader() {
    var el = document.getElementById('preloader');
    var fill = el ? el.querySelector('.preloader__fill') : null;
    if (!el) return;

    var MIN_DISPLAY_MS = 500;
    var start = Date.now();

    if (fill) {
      requestAnimationFrame(function () {
        fill.style.width = '92%';
      });
    }

    function hide() {
      var elapsed = Date.now() - start;
      var wait = Math.max(0, MIN_DISPLAY_MS - elapsed);
      setTimeout(function () {
        if (fill) fill.style.width = '100%';
        // .preloader__fill transitions `width` over --dur-slow (680ms).
        // The fade-out used to fire 150ms later, cutting the fill
        // transition off partway so the bar never visibly reached the
        // end. Wait out the full transition before starting the fade.
        setTimeout(function () {
          el.classList.add('is-hidden');
          el.setAttribute('aria-hidden', 'true');
        }, 700);
      }, wait);
    }

    if (document.readyState === 'complete') {
      hide();
    } else {
      window.addEventListener('load', hide);
      // Safety net: never block interaction for more than 1.8s.
      // (Previously 4s — on a slow connection the hero video is the
      // heaviest asset gating 'load', so the preloader could still be
      // covering the page while the hero title's reveal transition
      // was already mid-flight underneath it. When the net then fired,
      // the title appeared already half-transitioned/translucent —
      // read by users as the headline text "sliding together"/blurring
      // into the background. Firing sooner means the reveal always
      // starts from its own clean, fully-hidden state instead.)
      setTimeout(hide, 1800);
    }
  })();

  /* ==============================================================
     2. HEADER SCROLL STATE
     Trigger: scroll position > 24px
     Duration: --dur-base (420ms) background/blur transition, in CSS
     Purpose: header stays legible over hero video without
     permanently occluding the full-bleed imagery
     ============================================================== */
  (function navScrollState() {
    var nav = document.getElementById('nav');
    if (!nav) return;
    var THRESHOLD = 24;

    var update = rafThrottle(function () {
      if (window.scrollY > THRESHOLD) {
        nav.classList.add('is-scrolled');
      } else {
        nav.classList.remove('is-scrolled');
      }
    });

    window.addEventListener('scroll', update, { passive: true });
    update();
  })();

  /* ==============================================================
     3. MOBILE MENU (burger)
     Trigger: click on #burger
     Duration: --dur-slow (680ms) transform, --ease-atelier, in CSS
     Purpose: full-screen menu slides down like a shutter opening —
     matches the "architectural reveal" language used elsewhere
     Note: menu element lives at body level in the DOM (sibling of
     header), so its fixed positioning can never be trapped inside
     a transformed/opacity-animated ancestor stacking context.
     ============================================================== */
  (function mobileMenu() {
    var burger = document.getElementById('burger');
    var menu = document.getElementById('mobile-menu');
    var nav = document.getElementById('nav');
    if (!burger || !menu) return;

    var isOpen = false;
    var links = menu.querySelectorAll('[data-menu-link]');

    function open() {
      isOpen = true;
      menu.classList.add('is-open');
      menu.setAttribute('aria-hidden', 'false');
      burger.setAttribute('aria-expanded', 'true');
      burger.setAttribute('aria-label', 'Закрыть меню');
      if (nav) nav.classList.add('nav--menu-open');
      document.body.style.overflow = 'hidden';
    }

    function close() {
      isOpen = false;
      menu.classList.remove('is-open');
      menu.setAttribute('aria-hidden', 'true');
      burger.setAttribute('aria-expanded', 'false');
      burger.setAttribute('aria-label', 'Открыть меню');
      if (nav) nav.classList.remove('nav--menu-open');
      document.body.style.overflow = '';
    }

    burger.addEventListener('click', function () {
      isOpen ? close() : open();
    });

    links.forEach(function (link) {
      link.addEventListener('click', function (e) {
        var href = link.getAttribute('href') || '';
        // Anchor links: the mobile-menu overlay is position:fixed and
        // takes 680ms (--dur-slow) to translate off-screen. If we let
        // the browser follow the href immediately, it scrolls the page
        // *underneath* the still-visible/animating menu, so the jump
        // lands in the wrong place (or looks like it does) on the
        // first tap — only the second tap, with the menu already
        // closed, scrolls correctly. Instead: close the menu first,
        // then scroll to the target ourselves once it's actually gone.
        if (href.charAt(0) === '#' && href.length > 1) {
          // Actual scrolling for in-page anchors (including this one)
          // is handled by the single global anchor handler below, so
          // that both this menu link and every regular CTA button on
          // the page land correctly on the first click. Here we only
          // need to close the menu itself; prevent the default jump
          // so it doesn't fire twice.
          e.preventDefault();
          close();
        } else {
          close();
        }
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) close();
    });

    // Close if viewport grows past tablet breakpoint (e.g. device rotation)
    window.addEventListener('resize', rafThrottle(function () {
      if (window.innerWidth >= 768 && isOpen) close();
    }));

    // Expose whether the menu is currently open/animating so the
    // global anchor handler below knows whether to wait for it.
    window.__mobileMenuOpen = function () { return isOpen; };
  })();

  /* ==============================================================
     3b. GLOBAL ANCHOR SCROLL FIX
     Trigger: click on any in-page `#anchor` link, anywhere on the
     site (nav, mobile menu, model CTAs, footer, buttons, etc.)
     Problem this solves: sections further down the page are
     revealed by the IntersectionObserver in section 4 below, which
     grows the document's scrollHeight — a moving target. A single
     scrollIntoView call can end up aiming at a position that shifts
     under it mid-animation, landing short (this is why "Записаться
     на тест-райд" could land on FAQ instead of Контакты on the very
     first tap).
     Fix: intercept every internal anchor click and drive a manual
     smooth scroll (rAF + easing) to the target, re-reading its
     current position every frame so it tracks any layout growth
     happening underneath it, then snapping precisely once the
     animation ends. Falls back to an instant jump when the user
     prefers reduced motion.
     ============================================================== */
  (function globalAnchorScrollFix() {
    var anchors = document.querySelectorAll('a[href^="#"]');
    if (!anchors.length) return;

    var SCROLL_DUR = 700; // ms — matches the site's --dur-slow feel

    function getHeaderOffset() {
      var nav = document.getElementById('nav');
      if (!nav) return 0;
      var style = window.getComputedStyle(nav);
      if (style.position === 'fixed' || style.position === 'sticky') {
        return nav.getBoundingClientRect().height;
      }
      return 0;
    }

    function targetY(target) {
      return target.getBoundingClientRect().top + window.pageYOffset - getHeaderOffset();
    }

    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function smoothScrollTo(target) {
      if (prefersReducedMotion) {
        window.scrollTo(0, targetY(target));
        return;
      }

      var html = document.documentElement;
      var prevBehavior = html.style.scrollBehavior;
      // Neutralise any CSS `scroll-behavior: smooth` so it can't
      // fight this manual rAF-driven animation.
      html.style.scrollBehavior = 'auto';

      var startY = window.pageYOffset;
      var startTime = null;

      function frame(now) {
        if (startTime === null) startTime = now;
        var elapsed = now - startTime;
        var progress = Math.min(elapsed / SCROLL_DUR, 1);
        var eased = easeInOutCubic(progress);

        // Re-read the target's position every frame: if a reveal
        // animation is still growing the page underneath it, this
        // keeps the destination accurate instead of aiming at a
        // stale offset captured before the layout settled.
        var destY = targetY(target);
        window.scrollTo(0, startY + (destY - startY) * eased);

        if (progress < 1) {
          requestAnimationFrame(frame);
        } else {
          // Final precise snap once the animation has finished.
          window.scrollTo(0, targetY(target));
          html.style.scrollBehavior = prevBehavior;
        }
      }

      requestAnimationFrame(frame);
    }

    anchors.forEach(function (link) {
      var href = link.getAttribute('href') || '';
      if (href.charAt(0) !== '#' || href.length <= 1) return;

      link.addEventListener('click', function (e) {
        var target = document.querySelector(href);
        if (!target) return;
        e.preventDefault();

        var menuOpen = window.__mobileMenuOpen && window.__mobileMenuOpen();
        if (menuOpen) {
          // Let the mobile menu's own close animation (680ms) finish
          // first so the scroll isn't visually fighting the overlay.
          window.setTimeout(function () { smoothScrollTo(target); }, 700);
        } else {
          smoothScrollTo(target);
        }
      });
    });
  })();

  /* ==============================================================
     4. SCROLL REVEAL (Architectural Reveal)
     Trigger: IntersectionObserver, element 15% visible
     Duration: --dur-reveal (900ms), --ease-atelier, in CSS
     Purpose: content appears to rise into place like gallery
     panels being unveiled — reinforces "walking through a
     showroom" narrative from the brief
     ============================================================== */
  (function scrollReveal() {
    var targets = document.querySelectorAll('[data-reveal]');
    if (!targets.length) return;

    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    targets.forEach(function (el) {
      var delay = el.getAttribute('data-reveal-delay');
      if (delay) el.style.setProperty('--reveal-delay', delay + 'ms');
    });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

    targets.forEach(function (el) { observer.observe(el); });
  })();

  /* ==============================================================
     5. MAGNETIC BUTTONS
     Trigger: mousemove within button bounding box
     Duration: --dur-fast (240ms), --ease-magnetic, in CSS
     GPU: transform-only (translate), no layout properties touched
     Purpose: buttons feel physically responsive to the cursor,
     reinforcing a "precision engineering" tactile quality
     Disabled on touch devices — no persistent pointer to react to.
     ============================================================== */
  (function magneticButtons() {
    if (isTouch || prefersReducedMotion) return;

    var buttons = document.querySelectorAll('.btn');
    var STRENGTH = 0.35;

    buttons.forEach(function (btn) {
      var rect = null;

      btn.addEventListener('mouseenter', function () {
        rect = btn.getBoundingClientRect();
      });

      btn.addEventListener('mousemove', function (e) {
        if (!rect) rect = btn.getBoundingClientRect();
        var relX = e.clientX - (rect.left + rect.width / 2);
        var relY = e.clientY - (rect.top + rect.height / 2);
        btn.style.transform =
          'translate(' + (relX * STRENGTH).toFixed(2) + 'px, ' + (relY * STRENGTH).toFixed(2) + 'px)';
      });

      btn.addEventListener('mouseleave', function () {
        btn.style.transform = 'translate(0, 0)';
        rect = null;
      });
    });
  })();

  /* ==============================================================
     6. DEPTH PARALLAX — hero architectural grid lines
     Trigger: scroll, only while hero is in viewport
     GPU: transform (translateY) only
     Purpose: grid lines drift slower than content, suggesting
     depth in an otherwise flat plane — subtle, not a gimmick
     ============================================================== */
  (function heroParallax() {
    var grid = document.querySelector('.hero__grid');
    var hero = document.getElementById('hero');
    if (!grid || !hero || prefersReducedMotion || isTouch) return;

    var update = rafThrottle(function () {
      var rect = hero.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      var progress = 1 - (rect.bottom / (window.innerHeight + rect.height));
      grid.style.transform = 'translateY(' + (progress * 40).toFixed(2) + 'px)';
    });

    window.addEventListener('scroll', update, { passive: true });
  })();

  /* ==============================================================
     7. FAQ ACCORDION (Glass Morphing expand)
     Trigger: click on [data-faq-trigger]
     Duration: --dur-base (420ms), --ease-atelier, in CSS
     Purpose: panel height is measured (scrollHeight) rather than
     guessed, so the glide is exact regardless of answer length —
     avoids the jank of a fixed max-height guess
     ============================================================== */
  (function faqAccordion() {
    var items = document.querySelectorAll('[data-faq-item]');
    if (!items.length) return;

    items.forEach(function (item) {
      var trigger = item.querySelector('[data-faq-trigger]');
      var answer = item.querySelector('[data-faq-answer]');
      if (!trigger || !answer) return;

      trigger.addEventListener('click', function () {
        var isOpen = trigger.getAttribute('aria-expanded') === 'true';

        // Close all other items first
        items.forEach(function (other) {
          if (other === item) return;
          var otherTrigger = other.querySelector('[data-faq-trigger]');
          var otherAnswer = other.querySelector('[data-faq-answer]');
          if (otherTrigger && otherTrigger.getAttribute('aria-expanded') === 'true') {
            otherTrigger.setAttribute('aria-expanded', 'false');
            otherAnswer.style.setProperty('--answer-height', '0px');
          }
        });

        if (isOpen) {
          trigger.setAttribute('aria-expanded', 'false');
          answer.style.setProperty('--answer-height', '0px');
        } else {
          trigger.setAttribute('aria-expanded', 'true');
          answer.style.setProperty('--answer-height', answer.scrollHeight + 'px');
        }
      });
    });

    // Re-measure open answer on resize (font reflow / rotation)
    window.addEventListener('resize', rafThrottle(function () {
      items.forEach(function (item) {
        var trigger = item.querySelector('[data-faq-trigger]');
        var answer = item.querySelector('[data-faq-answer]');
        if (trigger && answer && trigger.getAttribute('aria-expanded') === 'true') {
          answer.style.setProperty('--answer-height', answer.scrollHeight + 'px');
        }
      });
    }));
  })();

  /* ==============================================================
     8. OWNERS CAROUSEL
     Trigger: arrow click, dot click, touch swipe, autoplay timer
     Duration: --dur-slow (680ms), --ease-atelier, in CSS (track)
     Purpose: minimalist single-slide-at-a-time carousel; autoplay
     pauses on hover/focus so testimonials remain readable
     ============================================================== */
  (function ownersCarousel() {
    var root = document.getElementById('owners-carousel');
    if (!root) return;

    var track = root.querySelector('[data-carousel-track]');
    var slides = root.querySelectorAll('[data-carousel-slide]');
    var prevBtn = root.querySelector('[data-carousel-prev]');
    var nextBtn = root.querySelector('[data-carousel-next]');
    var dotsWrap = root.querySelector('[data-carousel-dots]');
    if (!track || !slides.length) return;

    var current = 0;
    var total = slides.length;
    var AUTOPLAY_MS = 6000;
    var autoplayTimer = null;

    // Build dots
    var dots = [];
    if (dotsWrap) {
      slides.forEach(function (_, i) {
        var dot = document.createElement('button');
        dot.setAttribute('aria-label', 'Слайд ' + (i + 1));
        dot.addEventListener('click', function () { goTo(i); resetAutoplay(); });
        dotsWrap.appendChild(dot);
        dots.push(dot);
      });
    }

    function render() {
      dots.forEach(function (dot, i) {
        dot.classList.toggle('is-active', i === current);
      });
      slides.forEach(function (slide, i) {
        slide.classList.toggle('is-active', i === current);
      });
    }

    function goTo(index) {
      current = (index + total) % total;
      render();
    }

    function next() { goTo(current + 1); }
    function prev() { goTo(current - 1); }

    function startAutoplay() {
      if (prefersReducedMotion) return;
      stopAutoplay();
      autoplayTimer = setInterval(next, AUTOPLAY_MS);
    }

    function stopAutoplay() {
      if (autoplayTimer) clearInterval(autoplayTimer);
    }

    function resetAutoplay() {
      stopAutoplay();
      startAutoplay();
    }

    if (nextBtn) nextBtn.addEventListener('click', function () { next(); resetAutoplay(); });
    if (prevBtn) prevBtn.addEventListener('click', function () { prev(); resetAutoplay(); });

    root.addEventListener('mouseenter', stopAutoplay);
    root.addEventListener('mouseleave', startAutoplay);
    root.addEventListener('focusin', stopAutoplay);
    root.addEventListener('focusout', startAutoplay);

    // Touch swipe
    var touchStartX = 0;
    var touchDeltaX = 0;

    track.addEventListener('touchstart', function (e) {
      touchStartX = e.touches[0].clientX;
      stopAutoplay();
    }, { passive: true });

    track.addEventListener('touchmove', function (e) {
      touchDeltaX = e.touches[0].clientX - touchStartX;
    }, { passive: true });

    track.addEventListener('touchend', function () {
      var SWIPE_THRESHOLD = 40;
      if (touchDeltaX > SWIPE_THRESHOLD) prev();
      else if (touchDeltaX < -SWIPE_THRESHOLD) next();
      touchDeltaX = 0;
      startAutoplay();
    });

    render();
    startAutoplay();
  })();

})();