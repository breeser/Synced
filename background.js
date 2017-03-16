var group = [];
var online = [];
var offline = [];
var pending = [];
var client;
var clientKey;
var groupId = "";
var ws;
var messages = [];

chrome.notifications.onButtonClicked.addListener(inviteLocal);
chrome.notifications.onClosed.addListener(closedNotification);

chrome.identity.getAuthToken({ 'interactive': true }, function(token){
	if (chrome.runtime.lastError){
		console.log(chrome.runtime.lastError);
	}else{
		client = token;
		LoginSync(0);
	}
});

chrome.runtime.onConnect.addListener(function(port){
	console.assert(port.name == "syncLocal");
	port.onMessage.addListener(LocalSyncMessage);
});

chrome.extension.onMessage.addListener(function(request, sender, sendResponse){
	switch (request.type) {
		case "getGroup":
			sendResponse(group);
			break;
		case "getGroupID":
			sendResponse(groupId);
			break;
		case "LeaveGroup":
			leaveGroup();
			var b = chrome.extension.getViews({"type": "popup"});
			if (b.length > 0){
				for (var i =0; i < b.length; i++){
					b[i].leftGroup();
				}
			}
			sendResponse();
			break;
		case "getMessages":
			sendResponse(messages);
			break;
		case "getFriends":
			sendResponse({online:online, offline:offline, pending:pending});
			break;
		case "getServerStatus":
			sendResponse(ws.readyState != 1 ? 2 : clientKey != undefined ? 0 : 1 );
			break;
		default:
			sendResponse();
			break;
	}
});

function LoginSync(i){
	try {
		//ws = new WebSocket("ws://192.168.1.69:6969/");
		//ws = new WebSocket("ws://192.168.1.72:6969/");
		ws = new WebSocket("ws://99.32.178.167:6969/");
		ws.onopen = function(){
			i=0;
			var b = chrome.extension.getViews({"type": "popup"});
			if (b!= undefined){
				if (b.length > 0){
					for (var i =0; i < b.length; i++){
						b[i].changeServerStatus(1);
					}
				}
			}
			sendWebsocketData(JSON.stringify({command:"Login",data:JSON.stringify(client)}));
		};
		ws.onmessage = function (evt){ 
			var received_msg = evt.data;
			var obj = JSON.parse(received_msg);
			switch (obj.type){
				case "LoginInfo":
					var li = JSON.parse(obj.data);
					clientKey = li.Guid;
					online = li.Online;
					offline = li.Offline;
					var pend = []
					if (li.Pending != null){
						for (var i =0; i < li.Pending.length; i++){
							pend.push({email:li.Pending[i], picture:""});
						}
					}
					pending = pend;
					showFriendRequests(li.Requests);
					var b = chrome.extension.getViews({"type": "popup"});
					if (b!= undefined){
						if (b.length > 0){
							for (var i =0; i < b.length; i++){
								b[i].changeServerStatus(0);
							}
						}
					}
					break;
				case "Invite":
					invited(obj.data);
					break;
				case "GroupInfo":
					groupId = obj.data;
					getMembers();
					joinedGroup(groupId);
					break;
				case "GroupEvent":
					var member = JSON.parse(obj.data);
					if (member.Left == false){
						inviteAnswer(member);
					}else{
						left(member);
					}
					break;
				case "GMembers":
					if (obj.data != null){
						if (obj.data.length > 0 ){
							var users = JSON.parse(obj.data);
							for (var j =0; j < users.length; j++){
								group.push(users[j]);
							}
							modifyPopup(users, true);
						}
					}
					break;
				case "FriendEvent":
					friend = JSON.parse(obj.data);
					var fr = {email:friend.email, picture:friend.picture, Online:friend.Online, Removed:friend.Removed};
					moveList(fr);
					notifyOnline(fr);
					break;
				case "Event":
					kicked();
					break;
				case "Message":
					MessageReceived(obj);
					break;
				case "FriendRequest":
					var friend = JSON.parse(obj.data);
					showFriendRequests([friend]);
					break;
				case "Error":
					var err = JSON.parse(obj.data);
					alert(err.Error);
					break;
				default:
					if (obj.command == "Event"){
						passMessage(JSON.parse(obj.data));
					} else {
						console.log(obj);
					}
					break;
			}
		};
		ws.onclose = function(){
			onClose();
			if (i < 10)
				setTimeout(function(){LoginSync(++i);}, 10000);
			else
				setTimeout(function(){LoginSync(10);}, 60000);
		};
		ws.onerror = function(evt){
			onClose();
		}
	}
	catch (e){
		console.log(e);
	}
}

function kicked(){
	var options = {type:'basic', iconUrl:'icon.png' , title:"You have been kicked", message: "You have been voted off Noah's ark."};
	chrome.notifications.create(groupId, options, null );
	removeGroup();
}

function onClose(){
	removeGroup();
	online = [];
	offline = [];
	pending = [];
	var b = chrome.extension.getViews({"type": "popup"});
	if (b!= undefined){
		if (b.length > 0){
			for (var i =0; i < b.length; i++){
				b[i].changeServerStatus(2);
			}
		}
	}
}

function removeGroup(){
	group = [];
	groupId = "";
	messages = [];
		var b = chrome.extension.getViews({"type": "popup"});
	if (b!= undefined){
		if (b.length > 0){
			for (var i =0; i < b.length; i++){
				b[i].leftGroup();
			}
		}
	}
}

function moveList(fr){
	if (online == null){
		online = [];
	}
	if (offline == null){
		offline = [];
	}
	if (pending == null){
		pending = [];
	}
	removeFromList(online, fr.email);
	removeFromList(offline, fr.email);
	removeFromList(pending, fr.email);
	if (!fr.Removed){
		if (fr.Online){
			online.push(fr);
		} else {
			offline.push(fr);
		}
	}
}

function removeFromList(list, email){
	if (list != null){
		var i = list.length
		while (i--) {
			if (list[i].email == email){
				  list.splice(i, 1);
			}
		}
	}
}

function joinedGroup(groupId){
	var b = chrome.extension.getViews({"type": "popup"});
	if (b.length > 0){
		for (var i =0; i < b.length; i++){
			b[i].joinedGroup(groupId);
		}
	}
}

function showFriendRequests(friends){
	if (friends != null){
		for (var i = 0; i < friends.length; i++){
			var options = {type:'basic', iconUrl:'icon.png' , title:"Friend Request", message: friends[i].From + " Has addded you as a friend.", buttons:[{title:'Accept'},{title:'Decline'}], requireInteraction: true};
			var id = JSON.stringify({Email:friends[i].From, Guid:friends[i].Guid, Group:false});
			chrome.notifications.create(id, options, null );
		}
	}
}

function closedNotification(notificationId, byUser) {
	if (byUser){
		inviteLocal(notificationId, 1);
	}
}

function inviteLocal(a,b){
	chrome.notifications.clear(a, null);
	var res = JSON.parse(a);
	if (b == 0){
		if (res.Group){
			sendWebsocketData(JSON.stringify({command:"Response", data:JSON.stringify({"Guid":res.GroupId, "Accept":true, "Group":true}), "key":clientKey}));
			groupId = res.GroupId;
			joinedGroup(res.GroupId);
		} else {
			sendWebsocketData(JSON.stringify({command:"Response", data:JSON.stringify({"Email":res.Email, "Guid":res.Guid, "Accept":true, "Group":false}), "key":clientKey}));
		}
	}else if(b == 1){
		if (res.Group){
			sendWebsocketData(JSON.stringify({command:"Response", data:JSON.stringify({"Guid":res.GroupId, "Accept":false, "Group":true}), "key":clientKey}));
		} else {
			sendWebsocketData(JSON.stringify({command:"Response", data:JSON.stringify({"Email":res.Email, "Guid":res.Guid, "Accept":false, "Group":false}), "key":clientKey}));
		}
	}
}

function addFriend(email){
	var data = {email:email};
	sendWebsocketData(JSON.stringify({command:"AddFriend",data:JSON.stringify(data), key:clientKey}));
}

function modifyPopup(a, c){
	notifyTabs(group);
	if (a != undefined){
		var b = chrome.extension.getViews({"type": "popup"});
		if (b!= undefined){
			if (b.length > 0){
				for (var i = 0; i < a.length; i++){
					for (var j =0; j < b.length; j++){
						b[j].ModifyGroupList(a[i], c);
					}
				}
			}
		}
	}
}

function notifyTabs(group){
	chrome.tabs.query({}, function(tabs){
		for (var i = 0; i < tabs.length; i++){
			chrome.tabs.sendMessage(tabs[i].id, {message: {type:"group" ,group: group}}, null);
		}
	});
}

function notifyOnline(friend){
	var b = chrome.extension.getViews({"type": "popup"});
	if (b.length > 0){
		for (var i =0; i < b.length; i++){
			b[i].ModifyFriendsList(friend);
		}
	}else if (!friend.Removed){
		var options = {type:'basic', iconUrl:'icon.png' , title: friend.email + " is now " + (friend.Online? "online":"offline"), message: ""};
		chrome.notifications.create("friendOnline", options, null );
	}
}

function MessageReceived(a){
	Message = JSON.parse(a.data);
	messages.push({message:Message, time:Date()});
	var b = chrome.extension.getViews({"type": "popup"});
	if (b.length > 0){
		for (var i =0; i < b.length; i++){
			b[i].newMessage(Message.text, Message.from);
		}
	}else{
		var options = {type:'basic', iconUrl:'icon.png' , title: Message.from + " sent", message: Message.text};
		chrome.notifications.create("newMessage", options, null );
	}
}

function SendChatMessage(val){
	if (groupId != ""){
		sendWebsocketData(JSON.stringify({command:"Message", "key":clientKey, data:val}));
	}
}

function inviteAnswer(a){
	if (a.Accept){
		var client = {email:a.email, picture:a.Picture};
		group.push(client);
		modifyPopup([client], true);
	}
	var gStatus = a.Accept ? "Accepted" : "Rejected";
	var options = {type:'basic', iconUrl:'icon.png' , title:"Group Invite " + gStatus, message: a.email +" " + gStatus +" the group invitation"};
	chrome.notifications.create("inviteanswer", options, null );
}

function left(a){
	var index = -1;
	for (var i =0; i < group.length; i++){
		if (a.email == group[i].email){
			index =i;
			break;
		}
	}
	if (index > -1){
		group.splice(index, 1);
	}
	modifyPopup([a], false);
	var options = {type:'basic', iconUrl:'icon.png' , title:"User Left Group", message: a.email + " left the group."};
	chrome.notifications.create("12345", options, null );
}

function invited(a){
	var invite = JSON.parse(a);
	var options = {type:'basic', iconUrl:'icon.png' , title:"Group Invite", message: invite.Client + " Invited you to join a group.", buttons:[{title:'Join'},{title:'Decline'}], requireInteraction: true};
	var id = JSON.stringify({GroupId:invite.GroupID, Group:true});
	chrome.notifications.create(id, options, null );
}

function leaveGroup(){
	groupId = "";
	messages = [];
	group = [];
	sendWebsocketData(JSON.stringify({command:"Leave", "key":clientKey}));
}

function passMessage(msg){
	chrome.tabs.query({url: msg.url}, function(tabs){
		for (var i = 0; i < tabs.length; i ++){
			chrome.tabs.sendMessage(tabs[i].id, {message: msg}, null);
		}
	});
}

function getMembers(){
	if (groupId != ""){
		sendWebsocketData(JSON.stringify({command:"GroupInfo", data:JSON.stringify({"groupID":groupId}), "key":clientKey}));
	}
}

function LocalSyncMessage(msg){
	if (msg!= undefined){
		if (msg.type == "groupInvite"){
			AddToGroup(msg.user);
		}else if (msg.type == "ChatMessage"){
			SendChatMessage(msg.text);
		}else if (msg.type == "friendInvite"){
			addFriend(msg.user);
		}else if (msg.type == "remove"){
			removeFriend(msg.user);
		}else if (msg.type == "kick"){
			kick(msg.user);
		}else{
			sendMessage(msg);	
		}
	}
}

function sendMessage(msg){
	sendWebsocketData(JSON.stringify({command:"Event",data:JSON.stringify(msg), "key":clientKey}));
}

function AddToGroup(id){
	if (client != undefined ) {
		if (client.email != id){
			if (!group.includes(id)){
				sendWebsocketData(JSON.stringify({command:"Invite", data:JSON.stringify({"email":id}), "key":clientKey}));
			}
		}
	}
}

function kick(email){
	if (email != undefined){
		if (email.length > 0){
			sendWebsocketData(JSON.stringify({command:"Kick", data:JSON.stringify({"email":email}), "key":clientKey}));
		}
	}
}

function removeFriend(email){
	if (email != undefined){
		if (email.length > 0){
			sendWebsocketData(JSON.stringify({command:"RemoveFriend", data:JSON.stringify({"email":email}), "key":clientKey}));
		}
	}
}

function sendWebsocketData(data){
	if(ws.readyState != ws.CLOSED){
		ws.send(data);
	} else {
		console.log("not connected");
		//do something
	}
}
