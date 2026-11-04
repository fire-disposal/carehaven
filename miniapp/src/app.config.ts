import { SITE } from './content/site'

export default defineAppConfig({
  pages: [
    'pages/login/index',
    'pages/index/index',
    'pages/manage/index',
    'pages/qa/index',
    'pages/community/index',
    'pages/profile/index',
    'pages/assessment/index',
    'pages/feedback/index',
    'pages/about/index',
    'pages/agreement/index',
    'pages/checkin/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#1F5A50',
    navigationBarTitleText: SITE.name,
    navigationBarTextStyle: 'white',
    backgroundColor: '#F4EFE5',
  },
})
