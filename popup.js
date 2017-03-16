var port = chrome.runtime.connect({name: "syncLocal"});
var leave = null;
var group = "";
var chatinput;
var groupInvite;
var friendInvite;

//change
function generateClient(client, group){
	return "<div id=\""+ client.email + (group? "_g": "_f") +"\" class=\"client context"+ (group?" group" : " friend")+"\" data-id=\""+client.email+"\"><img class=\"img-circle\" src=\""+ (client.picture != "" ? client.picture: "default.png" )+ "\"><span class=\"groupMember\">"+ client.email + "</span></div>"
}

function ModifyFriendsList(friend){
	var client = document.getElementById(friend.email+"_f");
	if (client != null){
		client.parentElement.removeChild(client);
	}
	if (!friend.Removed){
		if (friend.Online) {
			var on = document.getElementById("OnFriends");
			if (on != null){
				var current = on.innerHTML;
				current += generateClient(friend, false);
				on.innerHTML = current;
			}
		} else {
			var off = document.getElementById("OffFriends");
			if (off != null){
				var current = off.innerHTML;
				current += generateClient(friend, false);
				off.innerHTML = current;
			}
		}
	}
}

function ModifyGroupList(client, add){
	if (add){
		var list = document.getElementById("groupMembers");
		if (list != null){
			var current = list.innerHTML;
			current += generateClient(client, true);
			list.innerHTML = current;
		}
	} else {
		var itm = document.getElementById(client.email+"_g");
		if (itm != undefined){
			itm.parentElement.removeChild(itm);
		}
	}
}

function FriendList (users, id){
	if (users != null){
		var list = document.getElementById(id);
		if (list != null){
			var current = list.innerHTML;
			for (var i = 0; i < users.length; i++){
				current += generateClient(users[i], false);
			}
			list.innerHTML = current;
		}
	}
}

function makeFriends(online, offline, pending){
	FriendList(online, "OnFriends");
	FriendList(offline, "OffFriends");
	FriendList(pending, "PendFriends");
}

function makeGroup(groupMembers){
	for (var i =0; i < groupMembers.length; i++){
		ModifyGroupList(groupMembers[i], true);
	}
}

function leftGroup(){
	leave.style.display = "none";
	removeAll();
}

function getGroupMembers(){
	chrome.extension.sendMessage({ type : "getGroup" }, function(response){
		makeGroup(response);
	});
}

function getFriends(){
	chrome.extension.sendMessage({ type : "getFriends" }, function(response){
		makeFriends(response.online, response.offline, response.pending);
	});
}

function getServerStatus(){
	chrome.extension.sendMessage({ type : "getServerStatus" }, function(response){
		console.log(response);
		changeServerStatus(response);
	});
}

function leaveGroup(){
	chrome.extension.sendMessage({ type : "LeaveGroup" }, null);
}

function addMessageToList(message){
	var chat = document.getElementById("chatview");
	if (chat != undefined){
		var a = chat.innerHTML;
		a = a + message;
	}
	var b = chat.scrollTop;
	if (chat.scrollTop + chat.clientHeight == chat.scrollHeight){
		chat.innerHTML = a;
		chat.scrollTop = chat.scrollHeight;
	} else {
		chat.innerHTML = a;
	}
}

function newMessage(message, client, timestamp){
	if (message != undefined){
		var date
		if (timestamp == null){
			date = new Date();
		} else {
			date = new Date(timestamp);
		}
		var time = "<div class = \"message\" >[" + (date.getHours()  > 12 ? date.getHours() -12 : date.getHours() == 0 ? "12" : date.getHours()) + ":" + (date.getMinutes() > 9 ? date.getMinutes() : "0" + date.getMinutes()  )+ " " + (date.getHours() > 12 ? "PM] " : "AM] ");
		var fullMessage = time + "<span class=\"user\">" + client + "</span>: " ;
		message = linkifyHtml(message, {
			defaultProtocol: 'https'
		});
		fullMessage += message + "</div>";
		addMessageToList(fullMessage);
	}
}

function joinedGroup(groupId){
	group = groupId;
	leave.style.display = "block";
}

function removeAll(){
	var group = document.getElementById("groupMembers");
	if (group != undefined){
		while (group.firstChild) {
			group.removeChild(group.firstChild);
		}
	}
	var chatbox = document.getElementById("chatview");
	if (chatbox != undefined){
		while (chatbox.firstChild) {
			chatbox.removeChild(chatbox.firstChild);
		}
	}
}

function sendMessage(e){
	if (e.which == 13){
		var input = chatinput.value;
		chatinput.value = "";
		if (input.trim().length > 0){
			port.postMessage({type:"ChatMessage", text:input});
		}
	}
}

function addFriend(e){
	if (e.which == 13){
		var friend = friendInvite.value;
		friend = friend.trim();
		if (friend.length > 0){
			friendInvite.value = "";
			port.postMessage({type:"friendInvite", user:friend});
		}
	}
}

function addToGroup(e){
	if (e.which == 13){
		var usr = document.getElementById("group");
		if (usr != undefined){
			var usrName = usr.value;
			if (usrName.length > 0){
				port.postMessage({type:"groupInvite", user:usrName});
			}
			usr.value =  "";
		}
	}
}

function isInGroup(e){
	var a = document.getElementById(e+"_g");
	return a != undefined;
}

function isFriend(e){
	var a = document.getElementById(e+"_f");
	return a != undefined;
}

function changeServerStatus(status){
	console.log(status);
	var bars = document.getElementsByClassName("titleStatus");
	var newClass;
	switch (status){
		case 0:
			newClass = "Green";
			break;
		case 1:
			newClass = "Orange";
			break;
		case 2:
			newClass = "Red";
			break;
		default:
			newClass = "";
			break;
	}
	for (var i = 0; i < bars.length; i++){
		var side = bars[i].getAttribute("data-id")
		var classes = bars[i].classList;
		for (var j = 0; j < classes.length; j++){
			if (classes[j] != "titleStatus") {
				bars[i].classList.remove(classes[j]);
			}
		}
		bars[i].classList.add("titleStatus"+side+newClass);
	}
}

var contextMenuClassName = "context-menu";
var contextMenuItemClassName = "context-menu__item";
var contextMenuLinkClassName = "context-menu__link";
var contextMenuActive = "context-menu--active";
var taskItemClassName = "context";
var taskItemInContext;
var clickCoords;
var clickCoordsX;
var clickCoordsY;
var menu;
var menuItems;
var menuState = 0;
var menuWidth;
var menuHeight;
var menuPosition;
var menuPositionX;
var menuPositionY;
var windowWidth;
var windowHeight;

function clickListener() {
document.addEventListener( "click", function(e) {
	var clickeElIsLink = clickInsideElement( e, contextMenuLinkClassName );
		if ( clickeElIsLink ) {
			e.preventDefault();
			menuItemListener( clickeElIsLink );
		} else {
			var button = e.which || e.button;
			if ( button === 1 ) {
				toggleMenuOff();
			}
		}
	});
}

function hasClass(element, cls) {
    for (var i =0; i < element.classList.length; i++){
		for (var j =0; j < cls.length; j++){
			if (element.classList[i] == cls[j]){
				return true;
			}
		}
	}
	return false;
}

function contextListener() {
	document.addEventListener( "contextmenu", function(e) {
		taskItemInContext = clickInsideElement( e, taskItemClassName );
		if ( taskItemInContext ) {
			e.preventDefault();
			var email = taskItemInContext.getAttribute("data-id");
			toggleMenuOn(hasClass(taskItemInContext, ["friend"])?"group" : "friend", isFriend(email), isInGroup(email));
			positionMenu(e);
		} else {
			taskItemInContext = null;
			toggleMenuOff();
		}
	});
}

function toggleMenuOn(state, friend, group) {
	var items = document.getElementsByClassName("context-menu__item");
	var classes = [state];
	group ? classes.push("friend1") : "" ;
	friend ? classes.push("group1"):  "";
	for (var i = 0; i < items.length; i++){
		if (hasClass(items[i], classes)) {
			items[i].classList.add("hidden");
		} else {
			items[i].classList.remove( "hidden" );
		}
	}
	if ( menuState !== 1 ) {
		menuState = 1;
		menu.classList.add( contextMenuActive );
	}
}

function toggleMenuOff() {
	if ( menuState !== 0 ) {
		menuState = 0;
		menu.classList.remove( contextMenuActive );
		var items = document.getElementsByClassName("context-menu__item");
		for (var i = 0; i < items.length; i++){
			items[i].classList.remove( "hidden" );
		}
	}
}

function menuItemListener( link ) {
	switch (link.getAttribute("data-action")){
		case "Delete":
			port.postMessage({type:"remove", user:taskItemInContext.getAttribute("data-id")});
			break;
		case "Invite":
			port.postMessage({type:"groupInvite", user:taskItemInContext.getAttribute("data-id")});
			break;
		case "Kick":
			port.postMessage({type:"kick", user:taskItemInContext.getAttribute("data-id")});
			break;
		case "Add":
			port.postMessage({type:"friendInvite", user:taskItemInContext.getAttribute("data-id")});
			break;
		default:
			console.log(link.getAttribute("data-action"));
			break;
	}
	toggleMenuOff();
}

function clickInsideElement( e, className ) {
	var el = e.srcElement || e.target;
	if ( el.classList.contains(className) ) {
		return el;
	} else {
		while ( el = el.parentNode ) {
			if ( el.classList && el.classList.contains(className) ) {
				return el;
			}
		}
	}
	return false;
}

function getPosition(e) {
	var posx = 0;
	var posy = 0;
	if (!e) var e = window.event;
	if (e.pageX || e.pageY) {
		posx = e.pageX;
		posy = e.pageY;
	} else if (e.clientX || e.clientY) {
		posx = e.clientX + document.body.scrollLeft + document.documentElement.scrollLeft;
		posy = e.clientY + document.body.scrollTop + document.documentElement.scrollTop;
	}
	return { x: posx, y: posy }
}

function positionMenu(e) {
	clickCoords = getPosition(e);
	clickCoordsX = clickCoords.x;
	clickCoordsY = clickCoords.y;
	menuWidth = menu.offsetWidth + 4;
	menuHeight = menu.offsetHeight + 4;
	windowWidth = window.innerWidth;
	windowHeight = window.innerHeight;
	if ( (windowWidth - clickCoordsX) < menuWidth ) {
		menu.style.left = windowWidth - menuWidth + "px";
	} else {
		menu.style.left = clickCoordsX + "px";
	}
	if ( (windowHeight - clickCoordsY) < menuHeight ) {
		menu.style.top = windowHeight - menuHeight + "px";
	} else {
		menu.style.top = clickCoordsY + "px";
	}
}

document.addEventListener('DOMContentLoaded', function (){
	menu = document.querySelector("#context-menu");
	menuItems = menu.querySelectorAll(".context-menu__item");
	document.getElementById("group").focus();
	leave = document.getElementById("leave");
	leave.addEventListener("click", function(){
		leaveGroup();
	});
	chrome.extension.sendMessage({ type : "getGroupID" }, function(response){
		group = response;
		if (group == ""){
			leave.style.display = "none";
		}
	});
	chatinput = document.getElementById("chatbox");
	if (chatinput != undefined){
		chatinput.addEventListener('keyup', sendMessage);
	}
	groupInvite = document.getElementById("group");
	if (groupInvite != undefined){
		groupInvite.addEventListener('keyup', addToGroup);
	}
	friendInvite = document.getElementById("friend");
	if (friendInvite != undefined){
		friendInvite.addEventListener('keyup', addFriend);
	}
	getFriends();
	getGroupMembers();
	chrome.extension.sendMessage({ type : "getMessages" }, function(response){
		for (var i =0; i < response.length; i++){
			newMessage(response[i].message.text,response[i].message.from, response[i].time);
		}
	});
	contextListener();
    clickListener();
	getServerStatus();
	/*newMessage("this is a test url https://www.google.com/search?q=i+mean+yolo+right%3F","test", null);
	newMessage("this is a test url https://www.google.com/search?q=i+mean+yolo+right%3F","test", null);
	newMessage("this is a test url https://www.google.com/search?q=i+mean+yolo+right%3F","test", null);
	newMessage("this is a test url https://www.google.com/search?q=i+mean+yolo+right%3F","test", null);
	newMessage("this is a test url https://www.google.com/search?q=i+mean+yolo+right%3F","test", null);
	newMessage("this is a test url https://www.google.com/search?q=i+mean+yolo+right%3F","test", null);
	newMessage("this is a test url https://www.google.com/search?q=i+mean+yolo+right%3F","test", null);
	newMessage("this is a test url https://www.google.com/search?q=i+mean+yolo+right%3F","test", null);
	newMessage("this is a test url https://www.google.com/search?q=i+mean+yolo+right%3F","test", null);
	newMessage("this is a test url https://www.google.com/search?q=i+mean+yolo+right%3F","test", null);
	newMessage("this is a test url https://www.google.com/search?q=i+mean+yolo+right%3F","test", null);
	newMessage("this is a test url https://www.google.com/search?q=i+mean+yolo+right%3F","test", null);
	newMessage("this is a test url https://www.google.com/search?q=i+mean+yolo+right%3F","test", null);
	makeFriends([{email:"online@test.com", picture:""}],[{email:"offline@test.com", picture:""}],[{email:"pending@test.com", picture:""}]);
	makeGroup([{email:"test@test.com", picture:""}]);*/
});
