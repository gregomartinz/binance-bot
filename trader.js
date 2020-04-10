const express = require('express')
const io = require('socket.io-client')
const moment = require('moment')
const _ = require('lodash')
const colors = require("colors")
const BigNumber = require('bignumber.js')
const axios = require('axios')
const Binance = require('node-binance-api')
const binance = require('binance-api-node').default
const nodemailer = require('nodemailer')
const TeleBot = require('telebot')

//////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////
//         PLEASE EDIT PREFERENCES BELOW
//////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////

const enable_margin = false //ENABLE OR DISABLE MARGIN TRADING
const send_email = false // USE SEND MAIL ---- true = YES; false = NO
const use_telegram = false //USE TELEGRAM 
const gmail_address = ''
const gmail_app_password = ''
const gmailEmail = encodeURIComponent(gmail_address)
const gmailPassword = encodeURIComponent(gmail_app_password)
const mailTransport = nodemailer.createTransport(`smtps://${gmailEmail}:${gmailPassword}@smtp.gmail.com`)

//////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////
//         PLEASE EDIT WITH YOUR BITCOINvsALTCOINS.com KEY HERE BELLOW
//////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////

const bva_key = "replace_with_your_BvA_key" 

//////////////////////////////////////////////////////////////////////////////////
//         VARIABLES TO KEEP TRACK OF BOT POSITIONS AND ACTIVITY
//////////////////////////////////////////////////////////////////////////////////

let trading_pairs = {}
let open_trades = {}
let trading_types = {}
let trading_qty = {}
let buy_prices = {}
let sell_prices = {}
let user_payload = []

let minimums = {}    

//////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////

const app = express()
app.get('/', (req, res) => res.send(""))
app.listen(process.env.PORT || 8003, () => console.log('NBT auto trader running.'.grey))


//////////////////////////////////////////////////////////////////////////////////
//              TELEGRAM BOT 
//////////////////////////////////////////////////////////////////////////////////
if(use_telegram){
    const telegramToken = 'replace_with_your_BOT_token' //BOT TOKEN -> ask BotFather
    let telChanel = -123456789 //Replace with your Chanel ID. if needed help go uncoment LINES 723 and 724
    
    const telBot = new TeleBot({
    token: telegramToken, // Required. Telegram Bot API token.
    polling: { // Optional. Use polling.
    interval: 700, // Optional. How often check updates (in ms).
    timeout: 0, // Optional. Update polling timeout (0 - short polling).
    limit: 100, // Optional. Limits the number of updates to be retrieved.
    retryTimeout: 5000, // Optional. Reconnecting timeout (in ms).
    // proxy: 'http://username:password@yourproxy.com:8080' // Optional. An HTTP proxy to be used.
    },
    // webhook: { // Optional. Use webhook instead of polling.
    //     key: 'key.pem', // Optional. Private key for server.
    //     cert: 'cert.pem', // Optional. Public key.
    //     url: 'https://....', // HTTPS url to send updates to.
    //     host: '0.0.0.0', // Webhook server host.
    //     port: 443, // Server port.
    //     maxConnections: 40 // Optional. Maximum allowed number of simultaneous HTTPS connections to the webhook for update delivery
    // },
    allowedUpdates: [], // Optional. List the types of updates you want your bot to receive. Specify an empty list to receive all updates.
    usePlugins: ['askUser'], // Optional. Use user plugins from pluginFolder.
    pluginFolder: '../plugins/', // Optional. Plugin folder location.
    pluginConfig: { // Optional. Plugin configuration.
    // myPluginName: {
    //   data: 'my custom value'
    // }
    }
    });    
}
//////////////////////////////////////////////////////////////////////////////////

const margin_pairs = ['ADABTC', 'ATOMBTC','BATBTC','BCHBTC','BNBBTC','DASHBTC','EOSBTC','ETCBTC',
    'ETHBTC','IOSTBTC','IOTABTC','LINKBTC','LTCBTC','MATICBTC','NEOBTC','ONTBTC','QTUMBTC',
    'RVNBTC','TRXBTC','VETBTC','XLMBTC','XMRBTC','XRPBTC','XTZBTC','ZECBTC']

//////////////////////////////////////////////////////////////////////////////////

const bnb_client = new Binance().options({
    APIKEY: '',
    APISECRET: ''
})


const binance_client = binance({
    apiKey: '',
    apiSecret: '',
})

//////////////////////////////////////////////////////////////////////////////////

const nbt_vers = "0.2.3"
const socket = io('https://nbt-hub.herokuapp.com', { query: "v="+nbt_vers+"&type=client&key=" + bva_key })

socket.on('connect', () => {
    console.log("Auto Trader connected.".grey)
})

socket.on('disconnect', () => {
    console.log("Auto Trader disconnected.".grey)
})

socket.on('message', (message) => {
    console.log(colors.magenta("NBT Message: " + message))
})

socket.on('buy_signal', async (signal) => {
    const tresult = _.findIndex(user_payload, (o) => { return o.stratid == signal.stratid })
    if (tresult > -1) {
        if (!trading_pairs[signal.pair+signal.stratid] && signal.new) {
            console.log(colors.grey('BUY_SIGNAL :: ENTER LONG TRADE ::', signal.stratname, signal.stratid, signal.pair))
            // SEND TRADE EMAIL
            if (send_email) {
                const mailOptions = {
                    from: '"🐬  BVA " <no-reply@gmail.com>',
                    to: gmail_address,
                    subject: "BUY_SIGNAL :: ENTER LONG TRADE :: " + signal.stratname + ' ' + signal.pair + ' ' + signal.price,
                    text: (signal.score?"score: "+signal.score:'score: NA') + "\n"
                }
                mailTransport.sendMail(mailOptions)
                .then(() => {})
                .catch(error => {
                    console.error('There was an error while sending the email ... trying again...')
                    setTimeout(() => {
                        mailTransport.sendMail(mailOptions).then(() => {
                        }).catch(error => { console.error('There was an error while sending the email: stop trying') })
                    }, 2000 )
                })
            }
            //SEND TELEGRAM MSG
            if (use_telegram) {
                let msg = "BUY_SIGNAL :: ENTER LONG TRADE :: " + signal.stratname + ' ' + signal.pair + ' ' + signal.price+"\n"
                msg += (signal.score?"score: "+signal.score:'score: NA') + "\n"
                telBot.sendMessage(telChanel, msg)
            }
            //////
            trading_pairs[signal.pair+signal.stratid] = true
            trading_types[signal.pair+signal.stratid] = "LONG"
            open_trades[signal.pair+signal.stratid] = true
            //////
            console.log(signal.pair, ' ===> BUY', signal.price, Number(user_payload[tresult].buy_amount))
            if (signal.pair == 'BTCUSDT') {
                trading_qty[signal.pair+signal.stratid] = Number(user_payload[tresult].buy_amount)
                ////
                const traded_buy_signal = {
                    key: bva_key,
                    stratname: signal.stratname,
                    stratid: signal.stratid,
                    trading_type: user_payload[tresult].trading_type,
                    pair: signal.pair, 
                    qty: Number(user_payload[tresult].buy_amount)
                }
                socket.emit("traded_buy_signal", traded_buy_signal)
                ////
                if (user_payload[tresult].trading_type === "real") {
                    bnb_client.mgMarketBuy("BTCUSDT", Number(user_payload[tresult].buy_amount), (error, response) => {
                        if ( error ) console.log( "ERROR 3 BTCUSDT ", Number(user_payload[tresult].buy_amount), error.body)
                        if (response) console.log(" mgMarketBuy BTCUSDT SUCESS 3")
                    })
                }
            }
            else {
                const alt = signal.pair.replace('BTC','')
                if (minimums[alt+'BTC'].minQty) {
                    const buy_amount = new BigNumber(user_payload[tresult].buy_amount)
                    const btc_qty = buy_amount.dividedBy(signal.price)
                    const qty = bnb_client.roundStep(btc_qty, minimums[alt+'BTC'].stepSize)
                    console.log("Market Buy ==> " + qty + " - " + alt + "BTC")
                    trading_qty[signal.pair+signal.stratid] = Number(qty)
                    ////
                    const traded_buy_signal = {
                        key: bva_key,
                        stratname: signal.stratname,
                        stratid: signal.stratid,
                        trading_type: user_payload[tresult].trading_type,
                        pair: signal.pair, 
                        qty: qty,
                    }
                    socket.emit("traded_buy_signal", traded_buy_signal)
                    ////
                    if (user_payload[tresult].trading_type === "real") {
                        if (margin_pairs.includes(alt+"BTC") && enable_margin === true) {
                            bnb_client.mgMarketBuy(alt+"BTC", Number(qty), (error, response) => {
                                if ( error ) { console.log("ERROR 3355333", error.body) }
                                else console.log("SUCCESS 222444222")
                            })
                        }
                        else {
                            bnb_client.marketBuy(alt+"USDT", Number(qty), (error, response) => {
                                if (error) { console.log("ERROR 7991117 marketBuy", alt+"USDT", Number(qty), error.body) }
                                else { console.log("SUCESS 99111 marketBuy", alt+"USDT", Number(qty)) }
                            })
                        }
                    }
                }
                else {
                    console.log("PAIR UNKNOWN", alt)
                }
            }
            //////
        }
        else if (trading_types[signal.pair+signal.stratid]==='SHORT' 
            && trading_qty[signal.pair+signal.stratid]
            && !signal.new
            && open_trades[signal.pair+signal.stratid]
        ) {
            console.log(colors.grey('BUY_SIGNAL :: BUY TO COVER SHORT TRADE ::', signal.stratname, signal.stratid, signal.pair))
            // SEND TRADE EMAIL
            if (send_email) {
                const mailOptions = {
                    from: '"🐬  BVA " <no-reply@gmail.com>',
                    to: gmail_address,
                    subject: "BUY_SIGNAL :: BUY TO COVER SHORT TRADE :: " + signal.stratname + ' ' + signal.pair + ' ' + signal.price,
                    text: (signal.score?"score: "+signal.score:'score: NA') + "\n"
                }
                mailTransport.sendMail(mailOptions)
                .then(() => {})
                .catch(error => {
                    console.error('There was an error while sending the email ... trying again...')
                    setTimeout(() => {
                        mailTransport.sendMail(mailOptions).then(() => {
                        }).catch(error => { console.error('There was an error while sending the email: stop trying') })
                    }, 2000 )
                })
            }
            //SEND TELEGRAM MSG
            if (use_telegram) {
                let msg = "BUY_SIGNAL :: BUY TO COVER SHORT TRADE :: " + signal.stratname + ' ' + signal.pair + ' ' + signal.price+"\n"
                msg += (signal.score?"score: "+signal.score:'score: NA') + "\n"
                telBot.sendMessage(telChanel, msg)
            }
            //////
            console.log(signal.pair, ' ---> BUY', Number(trading_qty[signal.pair+signal.stratid]))
            if (signal.pair == 'BTCUSDT') {
                /////
                const traded_buy_signal = {
                    key: bva_key,
                    stratname: signal.stratname,
                    stratid: signal.stratid,
                    trading_type: user_payload[tresult].trading_type,
                    pair: signal.pair, 
                    qty: Number(trading_qty[signal.pair+signal.stratid]),
                }
                socket.emit("traded_buy_signal", traded_buy_signal)
                /////
                if (user_payload[tresult].trading_type === "real") {
                    const qty = Number(trading_qty[signal.pair+signal.stratid])
                    bnb_client.mgMarketBuy("BTCUSDT", qty, (error, response) => {
                        if ( error ) console.log( "ERROR 5 BTCUST ", qty, error.body)
                        if (response) {
                            console.log("----- mgRepay BTC 5 -----")
                            bnb_client.mgRepay("BTC", qty, (error, response) => {
                                if (error) console.log("ERROR BTC 999", qty, error.body)
                                else console.log("SUCCESS BTC 888")
                            })
                        }
                    })
                }
            }
            else {
                const alt = signal.pair.replace('BTC','')
                if (minimums[alt+'BTC'].minQty) {
                    const qty = Number(trading_qty[signal.pair+signal.stratid])
                    console.log("QTY ====mgMarketBuy===> " + qty + " - " + alt + "BTC")
                    /////
                    const traded_buy_signal = {
                        key: bva_key,
                        stratname: signal.stratname,
                        stratid: signal.stratid,
                        trading_type: user_payload[tresult].trading_type,
                        pair: signal.pair, 
                        qty: qty,
                    }
                    socket.emit("traded_buy_signal", traded_buy_signal)
                    /////
                    if (user_payload[tresult].trading_type === "real") {
                        bnb_client.mgMarketBuy(alt + "BTC", Number(qty), (error, response) => {
                            if ( error ) console.log( "ERROR 6 ", alt, Number(qty), error.body)
                            if (response) {
                                console.log("---+-- mgRepay ---+--")
                                bnb_client.mgRepay(alt, Number(qty), (error, response) => {
                                    if (error) console.log("ERROR 244343333", alt, Number(qty), error.body)
                                    else console.log("SUCCESS 333342111")
                                })
                            }
                        })
                    }
                }
                else {
                    console.log("PAIR UNKNOWN", alt)
                }
            }
            //////
            delete(trading_pairs[signal.pair+signal.stratid])
            delete(trading_types[signal.pair+signal.stratid])
            delete(buy_prices[signal.pair+signal.stratid])
            delete(sell_prices[signal.pair+signal.stratid])
            delete(trading_qty[signal.pair+signal.stratid])
            delete(open_trades[signal.pair+signal.stratid])
            //////
        }
        else {
            console.log("BUY AGAIN", JSON.stringify(signal), trading_types[signal.pair+signal.stratid])
        }
    }
})

socket.on('sell_signal', async (signal) => {
    //console.log(signal)
    const tresult = _.findIndex(user_payload, (o) => { return o.stratid == signal.stratid })
    if (tresult > -1) {
        if (!trading_pairs[signal.pair+signal.stratid] && signal.new) {
            console.log(colors.grey('SELL_SIGNAL :: ENTER SHORT TRADE ::', signal.stratname, signal.stratid, signal.pair))
            // SEND TRADE EMAIL
            if (send_email) {
                const mailOptions = {
                    from: '"🐬  BVA " <no-reply@gmail.com>',
                    to: gmail_address,
                    subject: "SELL_SIGNAL :: ENTER SHORT TRADE :: " + signal.stratname + ' ' + signal.pair + ' ' + signal.price,
                    text: (signal.score?"score: "+signal.score:'score: NA') + "\n"
                }
                mailTransport.sendMail(mailOptions)
                .then(() => {})
                .catch(error => {
                    console.error('There was an error while sending the email ... trying again...')
                    setTimeout(() => {
                        mailTransport.sendMail(mailOptions).then(() => {
                        }).catch(error => { console.error('There was an error while sending the email: stop trying') })
                    }, 2000 )
                })
            }
            //SEND TELEGRAM MSG
            if (use_telegram) {
                let msg = "SELL_SIGNAL :: ENTER SHORT TRADE :: " + signal.stratname + ' ' + signal.pair + ' ' + signal.price+"\n"
                msg += (signal.score?"score: "+signal.score:'score: NA') + "\n"
                telBot.sendMessage(telChanel, msg)
            }
            //////
            trading_pairs[signal.pair+signal.stratid] = true
            trading_types[signal.pair+signal.stratid] = "SHORT"
            open_trades[signal.pair+signal.stratid] = true
            //////
            console.log(signal.pair, ' ===> SELL', signal.price, Number(user_payload[tresult].buy_amount))
            if (signal.pair == 'BTCUSDT') {
                trading_qty[signal.pair+signal.stratid] = Number(user_payload[tresult].buy_amount)
                const traded_sell_signal = {
                    key: bva_key,
                    stratname: signal.stratname,
                    stratid: signal.stratid,
                    trading_type: user_payload[tresult].trading_type,
                    pair: signal.pair, 
                    qty: Number(user_payload[tresult].buy_amount),
                }
                socket.emit("traded_sell_signal", traded_sell_signal)
                if (user_payload[tresult].trading_type === "real") {
                    bnb_client.mgBorrow("BTC", Number(user_payload[tresult].buy_amount), (error, response) => {
                        if ( error ) console.log("ERROR BTC 55", Number(user_payload[tresult].buy_amount), error.body)
                        else {
                            console.log("SUCESS BTC 4 mgMarketSell 444")
                            bnb_client.mgMarketSell("BTCUSDT", Number(user_payload[tresult].buy_amount), (error, response) => {
                                if ( error ) console.log("ERROR BTC 33333", error.body)
                                else console.log("mgMarketSell BTCUSDT SUCCESS 2222")
                            })
                        }
                    })
                }
            }
            else {
                const alt = signal.pair.replace('BTC','')
                if (minimums[alt+'BTC'].minQty) {
                    const buy_amount = new BigNumber(user_payload[tresult].buy_amount)
                    const btc_qty = buy_amount.dividedBy(signal.price)
                    const qty = bnb_client.roundStep(btc_qty, minimums[alt+'BTC'].stepSize)
                    trading_qty[signal.pair+signal.stratid] = Number(qty)
                    console.log("QTY ===mgBorrow===> " + qty + " - " + alt + "BTC")
                    const traded_sell_signal = {
                        key: bva_key,
                        stratname: signal.stratname,
                        stratid: signal.stratid,
                        trading_type: user_payload[tresult].trading_type,
                        pair: signal.pair, 
                        qty: qty,
                    }
                    socket.emit("traded_sell_signal", traded_sell_signal)
                    if (user_payload[tresult].trading_type === "real") {
                        bnb_client.mgBorrow(alt, Number(qty), (error, response) => {
                            if ( error ) { console.log("ERROR 55555555555", alt, Number(qty), JSON.stringify(error) ) }
                            else {
                                console.log("SUCESS 444444444 mgMarketSell 44444444")
                                bnb_client.mgMarketSell(alt+"BTC", Number(qty), (error, response) => {
                                    if ( error ) console.log("ERROR 333333333", JSON.stringify(error))
                                    else console.log("SUCCESS 22222222")
                                })
                            }
                        })
                    }
                }
                else {
                    console.log("PAIR UNKNOWN", alt)
                }
            }
            //////
        }
        else if (trading_types[signal.pair+signal.stratid]==='LONG' 
            && trading_qty[signal.pair+signal.stratid]
            && !signal.new
            && open_trades[signal.pair+signal.stratid]
        ) {
            console.log(colors.grey('SELL_SIGNAL :: SELL TO EXIT LONG TRADE ::', signal.stratname, signal.stratid, signal.pair))
            // SEND TRADE EMAIL
            if (send_email) {
                const mailOptions = {
                    from: '"🐬  BVA " <no-reply@gmail.com>',
                    to: gmail_address,
                    subject: "SELL_SIGNAL :: SELL TO EXIT LONG TRADE :: " + signal.stratname + ' ' + signal.pair + ' ' + signal.price,
                    text: (signal.score?"score: "+signal.score:'score: NA') + "\n"
                }
                mailTransport.sendMail(mailOptions)
                .then(() => {})
                .catch(error => {
                    console.error('There was an error while sending the email ... trying again...')
                    setTimeout(() => {
                        mailTransport.sendMail(mailOptions).then(() => {
                        }).catch(error => { console.error('There was an error while sending the email: stop trying') })
                    }, 2000 )
                })
            }
            //SEND TELEGRAM MSG
            if (use_telegram) {
                let msg = "SELL_SIGNAL :: SELL TO EXIT LONG TRADE :: " + signal.stratname + ' ' + signal.pair + ' ' + signal.price+"\n"
                msg += (signal.score?"score: "+signal.score:'score: NA') + "\n"
                telBot.sendMessage(telChanel, msg)
            }
            
            //////
            console.log(signal.pair, ' ---> SELL', Number(trading_qty[signal.pair+signal.stratid]))
            if (signal.pair == 'BTCUSDT') {
                const traded_sell_signal = {
                    key: bva_key,
                    stratname: signal.stratname,
                    stratid: signal.stratid,
                    trading_type: user_payload[tresult].trading_type,
                    pair: signal.pair, 
                    qty: Number(trading_qty[signal.pair+signal.stratid]),
                }
                socket.emit("traded_sell_signal", traded_sell_signal)
                if (user_payload[tresult].trading_type === "real") {
                    bnb_client.mgMarketSell("BTCUSDT", Number(trading_qty[signal.pair+signal.stratid]), (error, response) => {
                        if (error) { console.log("ERROR 7220017 BTCUSDT", Number(trading_qty[signal.pair+signal.stratid]), JSON.stringify(error)) }
                    })
                }
            }
            else {
                const alt = signal.pair.replace('BTC','')
                if (minimums[alt+'BTC'].minQty) {
                    const qty = trading_qty[signal.pair+signal.stratid]
                    ///
                    const traded_sell_signal = {
                        key: bva_key,
                        stratname: signal.stratname,
                        stratid: signal.stratid,
                        trading_type: user_payload[tresult].trading_type,
                        pair: signal.pair, 
                        qty: qty,
                    }
                    socket.emit("traded_sell_signal", traded_sell_signal)
                    ///
                    if (user_payload[tresult].trading_type === "real") {
                        if (margin_pairs.includes(alt+"BTC") && enable_margin === true) {
                            console.log("QTY =======mgMarketSell======> " + qty + " - " + alt + "BTC")
                            bnb_client.mgMarketSell(alt+"BTC", Number(qty), (error, response) => {
                                if (error) { console.log("ERROR 722211117", alt, Number(qty), JSON.stringify(error)) }
                                else { console.log("SUCESS 71111111", alt, Number(qty)) }
                            })
                        }
                        else {
                            console.log("QTY =======marketSell======> " + qty + " - " + alt + "USDT")
                            bnb_client.marketSell(alt+"USDT", Number(qty), (error, response) => {
                                if (error) { console.log("ERROR 7213331117 marketSell", alt+"USDT", Number(qty), JSON.stringify(error)) }
                                else { console.log("SUCESS 711000111 marketSell", alt+"USDT", Number(qty)) }
                            })
                        }
                    }
                    ///
                }
                else {
                    console.log("PAIR UNKNOWN", alt)
                }
            }
            //////
            delete(trading_pairs[signal.pair+signal.stratid])
            delete(trading_types[signal.pair+signal.stratid])
            delete(sell_prices[signal.pair+signal.stratid])
            delete(buy_prices[signal.pair+signal.stratid])
            delete(trading_qty[signal.pair+signal.stratid])
            delete(open_trades[signal.pair+signal.stratid])
            //////
        }
        else {
            console.log("SELL AGAIN", signal.stratname, signal.pair, 
                !signal.new, open_trades[signal.pair+signal.stratid], 
                trading_types[signal.pair+signal.stratid]
            )
        }
    }
})

socket.on('close_traded_signal', async (signal) => {
    console.log(colors.grey('NBT HUB =====> close_traded_signal', signal.stratid, signal.pair, signal.trading_type))
    const tresult = _.findIndex(user_payload, (o) => { return o.stratid == signal.stratid })
    if (tresult > -1) {
        if (trading_types[signal.pair+signal.stratid]==='LONG') {
            console.log(colors.grey('BUY_SIGNAL :: SELL TO EXIT LONG TRADE ::', signal.stratname, signal.stratid, signal.pair))
            const traded_sell_signal = {
                key: bva_key,
                stratname: signal.stratname,
                stratid: signal.stratid,
                trading_type: user_payload[tresult].trading_type,
                pair: signal.pair, 
                qty: signal.qty,
            }
            socket.emit("traded_sell_signal", traded_sell_signal)
            //////
            if (user_payload[tresult].trading_type === "real") {
                console.log(signal.pair, ' ===---==> SELL ', signal.qty)
                if (signal.pair == 'BTCUSDT') {
                    bnb_client.mgMarketSell("BTCUSDT", Number(signal.qty), (error, response) => {
                        if (error) { console.log("ERROR 1212 BTCUSDT", Number(signal.qty), JSON.stringify(error)) }
                    })
                }
                else {
                    const alt = signal.pair.replace('BTC','')
                    if (minimums[alt+'BTC'].minQty) {
                        const qty = signal.qty
                        ///
                        if (margin_pairs.includes(alt+"BTC")) {
                            console.log("CLOSE =========mgMarketSell=========> " + qty + " - " + alt + "BTC")
                            bnb_client.mgMarketSell(alt+"BTC", Number(qty), (error, response) => {
                                if (error) { console.log("ERORR 4547777745", alt, Number(qty), JSON.stringify(error))}
                                else { console.log("SUCESS44444", alt, Number(qty)) }
                            })
                        }
                        else {
                            console.log("CLOSE =========marketSell=========> " + qty + " - " + alt + "BTC")
                            bnb_client.marketSell(alt+"BTC", Number(qty), (error, response) => {
                                if (error) { console.log("ERROR 72317 marketSell", alt, Number(qty), JSON.stringify(error))}
                                else { console.log("SUCESS 716611 marketSell", alt, Number(qty)) }
                            })
                        }
                        ///
                    }
                    else {
                        console.log("PAIR UNKNOWN", alt)
                    }
                }
            }
            //////
            delete(trading_pairs[signal.pair+signal.stratid])
            delete(trading_types[signal.pair+signal.stratid])
            delete(sell_prices[signal.pair+signal.stratid])
            delete(trading_qty[signal.pair+signal.stratid])
            delete(open_trades[signal.pair+signal.stratid])
            //////
        }
        else if (trading_types[signal.pair+signal.stratid]==='SHORT') {
            console.log(colors.grey('CLOSE_SIGNAL :: BUY TO COVER SHORT TRADE ::', signal.stratname, signal.stratid, signal.pair))
            //////
            const traded_buy_signal = {
                key: bva_key,
                stratname: signal.stratname,
                stratid: signal.stratid,
                trading_type: user_payload[tresult].trading_type,
                pair: signal.pair,
                qty: signal.qty,
            }
            socket.emit("traded_buy_signal", traded_buy_signal)
            //////
            if (user_payload[tresult].trading_type === "real") {
                console.log(signal.pair, ' ---==---> BUY ', signal.qty)
                if (signal.pair == 'BTCUSDT') {
                    bnb_client.mgMarketBuy("BTCUSDT", signal.qty, (error, response) => {
                        if (error) console.log("ERROR 990099 BTCUSDT", Number(signal.qty), error.body)
                        if (response) {
                            console.log("----- mgRepay BTC -----")
                            bnb_client.mgRepay("BTC", Number(signal.qty), (error, response) => {
                                if (error) console.log("ERROR BTC 9", Number(signal.qty), error.body)
                                else console.log("SUCCESS BTC 8")
                            })
                        }
                    })
                }
                else {
                    const alt = signal.pair.replace('BTC','')
                    if (minimums[alt+'BTC'].minQty) {
                        const qty = trading_qty[signal.pair+signal.stratid]
                        console.log("QTY ==> " + qty + " - " + alt + "BTC")
                        bnb_client.mgMarketBuy(alt + "BTC", Number(qty), (error, response) => {
                            if ( error ) {
                                console.log( "ERROR 2 ", alt, Number(user_payload[tresult].buy_amount), error.body)
                            }
                            if (response) {
                                console.log("----- mgRepay -----")
                                bnb_client.mgRepay(alt, Number(qty), (error, response) => {
                                    if (error) console.log("ERROR 99999999999", alt, Number(qty), error.body)
                                    else console.log("SUCCESS 888888888888")
                                })
                            }
                        })
                    }
                    else {
                        console.log("PAIR UNKNOWN", alt)
                    }
                }
            }
            //////
            delete(trading_pairs[signal.pair+signal.stratid])
            delete(trading_types[signal.pair+signal.stratid])
            delete(buy_prices[signal.pair+signal.stratid])
            delete(trading_qty[signal.pair+signal.stratid])
            delete(open_trades[signal.pair+signal.stratid])
            //////
        }
    }
})

socket.on('stop_traded_signal', async (signal) => {
    console.log(colors.grey('NBT HUB =====> stop_traded_signal', signal.stratid, signal.pair, signal.trading_type))
    const tresult = _.findIndex(user_payload, (o) => { return o.stratid == signal.stratid })
    if (tresult > -1) {
        if (open_trades[signal.pair+signal.stratid]) {
            delete(open_trades[signal.pair+signal.stratid])
        }
    }
})

socket.on('user_payload', async (data) => {
    console.log(colors.grey('NBT HUB => user strategies + trading setup updated'))
    // console.log(data.length)
    user_payload = data
})

//////////////////////////////////////////////////////////////////////////////////

async function ExchangeInfo() {
    return new Promise((resolve, reject) => {
        bnb_client.exchangeInfo((error, data) => {
            if(error !== null) {
                console.log(error)
                return reject(error)
            }
            for ( let obj of data.symbols ) {
                let filters = {status: obj.status};
                for ( let filter of obj.filters ) {
                    if ( filter.filterType == "MIN_NOTIONAL" ) {
                        filters.minNotional = filter.minNotional;
                    } else if ( filter.filterType == "PRICE_FILTER" ) {
                        filters.minPrice = filter.minPrice;
                        filters.maxPrice = filter.maxPrice;
                        filters.tickSize = filter.tickSize;
                    } else if ( filter.filterType == "LOT_SIZE" ) {
                        filters.stepSize = filter.stepSize;
                        filters.minQty = filter.minQty;
                        filters.maxQty = filter.maxQty;
                    }
                }
                filters.orderTypes = obj.orderTypes;
                filters.icebergAllowed = obj.icebergAllowed;
                minimums[obj.symbol] = filters;
            }
            resolve(true)
        })
    })
}

async function UpdateOpenTrades() {
    return new Promise((resolve, reject) => {
        // Retrieve previous open trades //
        axios.get('https://bitcoinvsaltcoins.com/api/useropentradedsignals?key=' + bva_key )
        .then( (response) => {
            response.data.rows.map( s => {
                trading_pairs[s.pair+s.stratid] = true
                open_trades[s.pair+s.stratid] = !s.stopped
                trading_types[s.pair+s.stratid] = s.type
                trading_qty[s.pair+s.stratid] = s.qty
                buy_prices[s.pair+s.stratid] = new BigNumber(s.buy_price)
                sell_prices[s.pair+s.stratid] = new BigNumber(s.sell_price)
            })
            console.log("Open Trades:", _.values(trading_pairs).length)
            resolve(true)
        })
        .catch( (e) => {
            console.log("ERROR UpdateOpenTrades", e.response.data)
            return reject(false)
        })
    })
}

async function run() {
    await ExchangeInfo()
    await UpdateOpenTrades()
}

run()

//////////////////////////////////////////////////////////////////////////////////
//                      TELEGRAM BOT
/////////////////////////////////////////////////////////////////////////////////

if(use_telegram){    
// GET CHANEL ID
telBot.on('/info', async (msg) => {       
    let response = "Open Trades: "+ _.values(trading_pairs).length+"\n" 
    // response += "Chanel ID : "+msg.chat.id+"\n"  //IF UNCOMENT SHOW CHANEL ID 
    // telChanel = msg.chat.id
    return telBot.sendMessage(telChanel, response)
});

telBot.start();
}
//////////////////////////////////////////////////////////////////////////////////